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

import { randomBytes } from 'node:crypto';
import express, { type Request, type Response, Router, type NextFunction } from 'express';

import type { DeviceCodesStore, IssueDeviceCodeResult } from './device-codes';
import { issueDeviceCode } from './device-codes';
import type { AuthCodesStore } from './auth-codes';
import { OAuthError } from './errors';
import type { Issuer } from './issuer';
import type { PairingsStore } from './pairings';
import type { RateLimiter } from './rate-limit';
import { ipFromRequest } from './rate-limit';
import type { RevocationStore } from './revocation';
import { DEFAULT_SCOPE } from './scopes';
import { audit } from '../utils/audit';

export type OAuthRouterDeps = {
  issuer: Issuer;
  deviceCodes: DeviceCodesStore;
  authCodes: AuthCodesStore;
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
  // RFC 8628 §3.5: optional convenience URL with the user_code already
  // appended as ?user_code=XXXX-XXXX. Strict MCP clients (Cursor) open
  // this URL in the browser so the user does not have to type the code.
  verification_uri_complete?: string;
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
const AUTH_CODE_GRANT = 'authorization_code';
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

/**
 * RFC 6749 §4.1.3: exchange an authorization code for an access token.
 *
 * Body fields:
 *   - code (required):            the one-shot code from /authorize
 *   - redirect_uri (required):    must match the value from /authorize
 *   - client_id (required):       must match the value from /authorize
 *   - code_verifier (required):   PKCE verifier (RFC 7636)
 *
 * The authCodes store atomically validates PKCE, checks the redirect_uri,
 * and consumes the code in one step (no race window for replay).
 */
function handleAuthorizationCodeGrant(
  body: Record<string, unknown>,
  deps: OAuthRouterDeps,
  res: Response,
): void {
  const code = body.code;
  const redirectUri = body.redirect_uri;
  const clientId = body.client_id;
  const codeVerifier = body.code_verifier;
  const resource = body.resource;

  if (typeof code !== 'string' || code.length === 0) {
    oauthError(res, 'invalid_request', 'code is required', 400);
    return;
  }
  if (typeof redirectUri !== 'string' || redirectUri.length === 0) {
    oauthError(res, 'invalid_request', 'redirect_uri is required', 400);
    return;
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    oauthError(res, 'invalid_request', 'client_id is required', 400);
    return;
  }
  if (typeof codeVerifier !== 'string' || codeVerifier.length === 0) {
    oauthError(res, 'invalid_request', 'code_verifier is required', 400);
    return;
  }
  if (resource !== undefined && typeof resource !== 'string') {
    oauthError(res, 'invalid_request', 'resource must be a string', 400);
    return;
  }
  // RFC 7636 §4.1: code_verifier is 43-128 chars from [A-Z][a-z][0-9]-._~
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    oauthError(res, 'invalid_grant', 'code_verifier length must be 43..128', 400);
    return;
  }
  if (!/^[A-Za-z0-9\-._~]+$/.test(codeVerifier)) {
    oauthError(res, 'invalid_grant', 'code_verifier contains invalid characters', 400);
    return;
  }

  const row = deps.authCodes.consume(code, { codeVerifier, redirectUri });
  if (!row) {
    oauthError(res, 'invalid_grant', 'code is unknown, expired, or PKCE verification failed', 400);
    return;
  }
  if (row.clientId !== clientId) {
    // RFC 6749 §4.1.3: client_id MUST match.
    oauthError(res, 'invalid_grant', 'client_id does not match the authorization request', 400);
    return;
  }
  if (resource !== row.resource) {
    oauthError(res, 'invalid_grant', 'resource does not match the authorization request', 400);
    return;
  }

  const { token } = deps.issuer.signAccessToken({
    userId: row.userId,
    jti: row.jti,
    resource: row.resource,
  });
  deps.pairings.add({
    jti: row.jti,
    userId: row.userId,
    clientId: row.clientId,
    userCode: `authcode:${row.clientId.slice(0, 12)}`,
    approvedAt: new Date().toISOString(),
    deviceCode: '', // N/A for auth_code flow
  });

  const response: TokenSuccessResponse = {
    access_token: token,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: row.scope,
  };
  audit.tokenIssued({
    userId: row.userId,
    jti: row.jti,
    clientId: row.clientId,
    userCode: `authcode:${row.clientId.slice(0, 12)}`,
  });
  res.status(200).json(response);
}

export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const router = Router();
  // Device registration accepts JSON. OAuth token requests use
  // application/x-www-form-urlencoded per RFC 6749, so support both formats.
  router.use(express.json({ limit: '4kb' }));
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

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
        // Build the convenience URL: base + ?user_code=XXXX-XXXX
        // (encoded). Cursor opens this directly in the browser.
        verification_uri_complete: `${deps.verificationUri}?user_code=${encodeURIComponent(issued.userCode)}`,
        expires_in: deps.deviceCodeTtlSeconds,
        interval: deps.devicePollIntervalSeconds,
      };
      audit.deviceIssued({
        ip: ipFromRequest({
          ip: req.ip,
          socket: req.socket as { remoteAddress?: string } | undefined,
        }),
        clientId,
        userCode: issued.userCode,
      });
      res.status(200).json(response);
    },
  );

  // ---- POST /token and /oauth/token ----
  // Supports two grant types:
  //   - device_code (RFC 8628): legacy Claude Code flow
  //   - authorization_code (RFC 6749 §4.1.3): MCP clients using PKCE
  router.post(
    ['/token', '/oauth/token'],
    gateEnabled(deps),
    rateLimit('oauth_token', deps),
    (req: Request, res: Response): void => {
      const body = parseBody(req);
      const grantType = body.grant_type;
      if (grantType === AUTH_CODE_GRANT) {
        handleAuthorizationCodeGrant(body, deps, res);
        return;
      }
      if (grantType !== DEVICE_GRANT) {
        oauthError(
          res,
          'unsupported_grant_type',
          `grant_type must be ${DEVICE_GRANT} or ${AUTH_CODE_GRANT}`,
          400,
        );
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

      // Mint an MCP access token. The jti is reused from the device row so
      // that revoking the pairing (via /api/agents/:jti) also invalidates
      // the access token (revocation map is keyed on jti).
      const { token } = deps.issuer.signAccessToken({ userId, jti: row.jti });

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
      audit.tokenIssued({ userId, jti: row.jti, clientId: row.clientId, userCode: row.userCode });
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
        audit.tokenRevoked({ jti: claims.jti, reason: 'oauth-revoke-endpoint' });
      } catch {
        // RFC 7009 §2.2: server should respond 200 even on unknown/invalid tokens.
        // Still record the rejection for audit visibility.
        audit.tokenRejected({ reason: 'invalid-token-on-revoke' });
      }
      res.status(200).json({ ok: true });
    },
  );

  // ---- POST /register and /oauth/register (RFC 7591 Dynamic Client Registration) ----
  // Cursor's MCP client requires this endpoint to complete setup. We
  // implement the minimum: accept any registration request, echo back a
  // client_id we just generated, and return the metadata Cursor needs to
  // proceed with the authorization-code or device-code flow. Public client
  // (no secret); authorization codes are bound to PKCE and user approval.
  router.post(
    ['/register', '/oauth/register'],
    gateEnabled(deps),
    (req: Request, res: Response): void => {
      const body = parseBody(req);
      // OAuth clients send a JSON object with redirect_uris and client_name.
      // Redirects are validated when /oauth/authorize is called.
      const requestedClientName =
        typeof body.client_name === 'string' ? body.client_name : 'mcp-client';
      const redirectUris = Array.isArray(body.redirect_uris)
        ? body.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
        : [];
      // Generate a unique, recognizable client_id. The store is in-process
      // (no per-client secret here); pairings record the actual binding
      // when /oauth/token exchanges a device_code.
      const issuedAt = new Date().toISOString();
      const clientId = `mcp-${randomBytes(12).toString('base64url')}`;
      audit.clientRegistered({
        clientId,
        clientName: requestedClientName,
        ip: ipFromRequest({
          ip: req.ip,
          socket: req.socket as { remoteAddress?: string } | undefined,
        }),
      });
      res.status(201).json({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.parse(issuedAt) / 1000),
        client_name: requestedClientName,
        // RFC 7591 §3.2.2: redirect_uris is required for authorization_code.
        // The client supplies its redirect URI in the registration request;
        // return the registered values in the response.
        redirect_uris: redirectUris,
        // Public client: no secret; PKCE protects authorization-code grants.
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'urn:ietf:params:oauth:grant-type:device_code'],
        response_types: ['code'],
        scope: DEFAULT_SCOPE,
      });
    },
  );

  return router;
}
