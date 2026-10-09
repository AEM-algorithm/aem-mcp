// RFC 8628 OAuth routes for aem-mcp.
//
// Phase 3 implements:
//   POST /oauth/device  — issue a device_code + user_code
//   POST /oauth/token   — exchange a device_code for an MCP access token
//   POST /oauth/refresh — placeholder (D5: no refresh tokens, re-pair instead)
//   POST /oauth/revoke  — revoke an MCP access token (jti)
//
// All routes are gated by `OAUTH_ENABLED` (catastrophic rollback).
// `/oauth/device` and `/oauth/token` are rate-limited per IP per spec D7.

import { type Request, type Response, Router, type NextFunction } from 'express';

import type { DeviceCodesStore, IssueDeviceCodeResult } from './device-codes';
import { issueDeviceCode } from './device-codes';
import { OAuthError } from './errors';
import type { Issuer } from './issuer';
import type { PairingsStore } from './pairings';
import type { RateLimiter } from './rate-limit';
import { ipFromRequest } from './rate-limit';
import type { RevocationStore } from './revocation';
import { DEFAULT_SCOPE } from './scopes';

export type OAuthRouterDeps = {
  issuer: Issuer;
  deviceCodes: DeviceCodesStore;
  pairings: PairingsStore;
  revocation: RevocationStore;
  rateLimiter: RateLimiter;
  oauthEnabled: boolean;
  verificationUri: string;
  deviceCodeTtlSeconds: number;
  devicePollIntervalSeconds: number;
};

type DeviceIssueResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type TokenSuccessResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
};

type OAuthErrorResponse = {
  error: string;
  error_description?: string;
};

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REFRESH_GRANT = 'refresh_token';

function oauthError(
  res: Response,
  code: string,
  description: string,
  httpStatus: number,
): void {
  const body: OAuthErrorResponse = { error: code, error_description: description };
  res.status(httpStatus).json(body);
}

function gateEnabled(deps: OAuthRouterDeps) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!deps.oauthEnabled) {
      oauthError(
        res,
        'temporarily_unavailable',
        'OAuth is disabled (OAUTH_ENABLED=false)',
        503,
      );
      return;
    }
    next();
  };
}

function rateLimit(route: 'oauth_device' | 'oauth_token', deps: OAuthRouterDeps) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = ipFromRequest({
      ip: req.ip,
      socket: req.socket as { remoteAddress?: string } | undefined,
    });
    if (!deps.rateLimiter.consume(route, ip)) {
      res.setHeader('Retry-After', '60');
      oauthError(
        res,
        'temporarily_unavailable',
        `rate limit exceeded for ${route}`,
        429,
      );
      return;
    }
    next();
  };
}

function parseBody(req: Request): Record<string, unknown> {
  // express.json() populates req.body as a plain object.
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const router = Router();

  // ---- POST /oauth/device ----
  router.post(
    '/oauth/device',
    gateEnabled(deps),
    rateLimit('oauth_device', deps),
    (req: Request, res: Response): void => {
      const body = parseBody(req);
      const clientId =
        typeof body.client_id === 'string' && body.client_id.length > 0
          ? body.client_id
          : 'claude-code'; // v1: only one client, default to claude-code
      const scope = typeof body.scope === 'string' ? body.scope : DEFAULT_SCOPE;

      let issued: IssueDeviceCodeResult;
      try {
        issued = issueDeviceCode(deps.deviceCodes, {
          clientId,
          scope,
          ttlSeconds: deps.deviceCodeTtlSeconds,
          intervalSeconds: deps.devicePollIntervalSeconds,
        });
      } catch (err) {
        if (err instanceof OAuthError) {
          oauthError(res, err.code, err.message, err.httpStatus);
          return;
        }
        oauthError(res, 'server_error', 'failed to issue device code', 500);
        return;
      }

      const response: DeviceIssueResponse = {
        device_code: issued.deviceCode,
        user_code: issued.userCode,
        verification_uri: deps.verificationUri,
        expires_in: deps.deviceCodeTtlSeconds,
        interval: deps.devicePollIntervalSeconds,
      };
      res.status(200).json(response);
    },
  );

  // ---- POST /oauth/token ----
  router.post(
    '/oauth/token',
    gateEnabled(deps),
    rateLimit('oauth_token', deps),
    (req: Request, res: Response): void => {
      const body = parseBody(req);
      const grantType = body.grant_type;
      if (grantType !== DEVICE_GRANT) {
        oauthError(res, 'unsupported_grant_type', `grant_type must be ${DEVICE_GRANT}`, 400);
        return;
      }
      const deviceCode = body.device_code;
      if (typeof deviceCode !== 'string' || deviceCode.length === 0) {
        oauthError(res, 'invalid_request', 'device_code is required', 400);
        return;
      }

      let row;
      try {
        row = deps.deviceCodes.get(deviceCode);
      } catch (err) {
        if (err instanceof OAuthError) {
          oauthError(res, err.code, err.message, err.httpStatus);
          return;
        }
        oauthError(res, 'server_error', 'failed to read device code', 500);
        return;
      }
      if (!row) {
        oauthError(res, 'invalid_grant', 'device_code not found', 400);
        return;
      }
      if (row.status === 'pending') {
        oauthError(res, 'authorization_pending', 'user has not approved yet', 400);
        return;
      }
      if (row.status === 'denied') {
        oauthError(res, 'access_denied', 'user denied the request', 400);
        return;
      }
      // status === 'approved' (or any other unhandled state) — fall through.
      const userId = row.userId;
      const jti = row.jti;
      if (typeof userId !== 'number' || typeof jti !== 'string') {
        // approved row without binding is a programming error
        oauthError(res, 'server_error', 'approved device_code missing user binding', 500);
        return;
      }

      // Mint an MCP access token.
      const { token } = deps.issuer.signAccessToken({ userId });

      // Record the durable pairing (used by Phase 6 GET/DELETE /api/agents).
      deps.pairings.add({
        jti,
        userId,
        clientId: row.clientId,
        userCode: row.userCode,
        approvedAt: new Date().toISOString(),
        deviceCode: row.deviceCode,
      });

      // One-shot: consume the row so the same device_code cannot be exchanged again.
      deps.deviceCodes.remove(deviceCode);

      const response: TokenSuccessResponse = {
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: row.scope,
      };
      res.status(200).json(response);
    },
  );

  // ---- POST /oauth/refresh ----
  router.post(
    '/oauth/refresh',
    gateEnabled(deps),
    (req: Request, res: Response): void => {
      const body = parseBody(req);
      if (body.grant_type !== REFRESH_GRANT) {
        oauthError(res, 'unsupported_grant_type', `grant_type must be ${REFRESH_GRANT}`, 400);
        return;
      }
      // D5: no refresh tokens; user must re-pair via /oauth/device.
      oauthError(
        res,
        'unsupported_grant_type',
        'refresh_token grant is not supported; re-pair via /oauth/device',
        400,
      );
    },
  );

  // ---- POST /oauth/revoke ----
  router.post(
    '/oauth/revoke',
    gateEnabled(deps),
    (req: Request, res: Response): void => {
      const body = parseBody(req);
      const token = body.token;
      if (typeof token !== 'string' || token.length === 0) {
        oauthError(res, 'invalid_request', 'token is required', 400);
        return;
      }
      try {
        const claims = deps.issuer.verifyAccessToken(token);
        deps.revocation.revoke(claims.jti, 'mcp-access-token');
      } catch {
        // RFC 7009 §2.2: server should respond 200 even on unknown/invalid tokens.
      }
      res.status(200).json({ ok: true });
    },
  );

  return router;
}
