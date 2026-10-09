// RFC 7519 JWT issuer/verifier for two token kinds, both HS256 (D2):
//
//   1. MCP access token — what the agent uses to call /mcp.
//      Claims: { sub: <userId-as-string>, aud: "aem-mcp", jti: <uuid>,
//                iat, exp, scope: "aem-mcp:read" }
//
//   2. Exchange code — aem-mcp receives this from aem-backend after the user
//      logs in. The backend signs it with the same MCP_OAUTH_SIGNING_KEY,
//      aud="aem-mcp", TTL 60s, and aem-mcp verifies locally before binding
//      it to a device_code.
//      Claims: { sub: <userId-as-string>, aud: "aem-mcp", jti: <uuid>,
//                iat, exp }
//
// The exchange_code is a *consumer* of the issuer module on the aem-mcp
// side; aem-mcp itself does not mint exchange codes (aem-backend does).
// We expose `verifyExchangeCode` only.

import { randomUUID } from 'node:crypto';

import jwt, { JsonWebTokenError, TokenExpiredError, type JwtPayload } from 'jsonwebtoken';

import { OAuthError } from './errors';
import { DEFAULT_SCOPE, type OAuthScope } from './scopes';

const ALG = 'HS256' as const;
const AUD = 'aem-mcp' as const;

export type McpAccessTokenClaims = {
  sub: string;
  aud: typeof AUD;
  jti: string;
  iat: number;
  exp: number;
  scope: OAuthScope;
};

export type ExchangeCodeClaims = {
  sub: string;
  aud: typeof AUD;
  jti: string;
  iat: number;
  exp: number;
};

export type Issuer = {
  signAccessToken: (input: { userId: number; ttlSeconds?: number; now?: () => number }) => {
    token: string;
    claims: McpAccessTokenClaims;
  };
  verifyAccessToken: (token: string) => McpAccessTokenClaims;
  verifyExchangeCode: (token: string) => ExchangeCodeClaims;
};

function isExpiredError(err: unknown): boolean {
  return err instanceof TokenExpiredError;
}

function safeDecode(token: string): JwtPayload {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      throw new OAuthError('invalid_grant', 'malformed token', 400);
    }
    return decoded.payload as JwtPayload;
  } catch (err) {
    if (err instanceof OAuthError) {
      throw err;
    }
    throw new OAuthError('invalid_grant', 'malformed token', 400);
  }
}

export function createIssuer(opts: {
  signingKey: string;
  accessTokenTtlSeconds?: number;
}): Issuer {
  const accessTokenTtl = opts.accessTokenTtlSeconds ?? 3600;

  // For both token kinds: signature/exp/aud failures collapse to
  // invalid_grant (access) or access_denied (exchange) per the spec
  // error tables; missing-required-claim is a distinct shape error.
  function verifyHs256(token: string, failureCode: 'invalid_grant' | 'access_denied'): JwtPayload {
    try {
      return jwt.verify(token, opts.signingKey, {
        algorithms: [ALG],
        audience: AUD,
      }) as JwtPayload;
    } catch (err) {
      if (isExpiredError(err)) {
        throw new OAuthError(failureCode, `${failureCode === 'access_denied' ? 'exchange_code' : 'access token'} expired`, 400);
      }
      if (err instanceof JsonWebTokenError) {
        // includes signature mismatch + audience mismatch
        throw new OAuthError(failureCode, `invalid token: ${err.message}`, 400);
      }
      throw new OAuthError(failureCode, 'invalid token', 400);
    }
  }

  return {
    signAccessToken({ userId, ttlSeconds = accessTokenTtl, now = Date.now }) {
      const iat = Math.floor(now() / 1000);
      const exp = iat + ttlSeconds;
      const claims: McpAccessTokenClaims = {
        sub: String(userId),
        aud: AUD,
        jti: randomUUID(),
        iat,
        exp,
        scope: DEFAULT_SCOPE,
      };
      // iat is intentionally included in the claims so the verifier can
      // inspect it. `noTimestamp: true` would silently drop the field
      // from the payload even when set in the input.
      const token = jwt.sign(claims, opts.signingKey, { algorithm: ALG });
      return { token, claims };
    },
    verifyAccessToken(token) {
      const payload = verifyHs256(token, 'invalid_grant');
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        typeof payload.scope !== 'string'
      ) {
        throw new OAuthError('invalid_grant', 'access token has wrong claim shape', 400);
      }
      return {
        sub: payload.sub,
        aud: AUD,
        jti: payload.jti,
        iat: payload.iat,
        exp: payload.exp,
        scope: payload.scope as OAuthScope,
      };
    },
    verifyExchangeCode(token) {
      const payload = verifyHs256(token, 'access_denied');
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        throw new OAuthError('access_denied', 'exchange_code has wrong claim shape', 400);
      }
      return {
        sub: payload.sub,
        aud: AUD,
        jti: payload.jti,
        iat: payload.iat,
        exp: payload.exp,
      };
    },
  };
}

// Re-export for tests that want to introspect a raw token without going
// through the verifier (e.g. to build an expired token for negative cases).
export function decodeUnsafe(token: string): JwtPayload {
  return safeDecode(token);
}

export const ISSUER_AUDIENCE = AUD;
export const ISSUER_ALGORITHM = ALG;
