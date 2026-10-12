// Local verifier for aem-mcp's MCP access tokens (Phase 5).
//
// The token is HS256, signed with the shared `MCP_OAUTH_SIGNING_KEY`,
// with claims:
//   { sub: <userId-as-string>, aud: 'aem-mcp', jti: <uuid>, iat, exp }
//
// Distinct from the existing session-token verifier in `verify-session-token.ts`:
//   - Session token: `JWT_SECRET`, claims `{ id: <number>, ... }`
//   - MCP access token: `MCP_OAUTH_SIGNING_KEY`, claims `{ sub, aud, jti, iat, exp }`
//
// Use the new `verifyAccessToken` for the Bearer path; the legacy session
// path is unchanged.

import jwt from 'jsonwebtoken';

import type { Env } from '../config/env';
import { getOAuthResourceBaseUrl, isSupportedOAuthResource } from './resource';

export class AccessTokenError extends Error {
  public readonly code: 'invalid_token' | 'wrong_audience' | 'expired';

  constructor(code: 'invalid_token' | 'wrong_audience' | 'expired', message: string) {
    super(message);
    this.name = 'AccessTokenError';
    this.code = code;
  }
}

export type McpAccessTokenClaims = {
  sub: string; // userId as string
  aud: string;
  resource?: string;
  jti: string; // UUID
  iat: number;
  exp: number;
  scope: string;
};

export type VerifiedAccessToken = {
  userId: number;
  jti: string;
  scope: string;
  resource?: string;
};

export function verifyAccessToken(token: string, env: Env): VerifiedAccessToken {
  let decoded: Record<string, unknown>;
  try {
    decoded = jwt.verify(token, env.MCP_OAUTH_SIGNING_KEY, {
      algorithms: ['HS256'],
    }) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AccessTokenError('expired', 'access token expired');
    }
    throw new AccessTokenError('invalid_token', 'invalid access token');
  }

  const sub = decoded.sub;
  const aud = decoded.aud;
  const jti = decoded.jti;
  const expectedResource = getOAuthResourceBaseUrl(env.PUBLIC_URL, env.PORT);
  if (
    typeof sub !== 'string' ||
    aud !== 'aem-mcp' ||
    (decoded.resource !== undefined &&
      (typeof decoded.resource !== 'string' ||
        !isSupportedOAuthResource(decoded.resource, expectedResource))) ||
    typeof jti !== 'string'
  ) {
    throw new AccessTokenError(
      'wrong_audience',
      'access token has wrong audience or claim shape',
    );
  }
  const userId = Number.parseInt(sub, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AccessTokenError('invalid_token', 'access token has invalid subject');
  }
  const scope = typeof decoded.scope === 'string' ? decoded.scope : 'aem-mcp:read';
  return {
    userId,
    jti,
    scope,
    ...(typeof decoded.resource === 'string' ? { resource: decoded.resource } : {}),
  };
}
