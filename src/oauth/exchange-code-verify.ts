// Local verifier for aem-backend's `exchangeCode` JWT.
//
// The backend mints a short-lived HS256 JWT (60s TTL) at
// `POST /api/oauth/exchange` with claims:
//   { sub: <userId-as-string>, aud: 'aem-mcp', jti: <uuid>, iat, exp }
//
// aem-mcp verifies locally with the shared `MCP_OAUTH_SIGNING_KEY` so the
// user does not need to re-prompt credentials. On success, the caller
// binds the verified `userId` to a `device_code` (Phase 4 flow).

import jwt from 'jsonwebtoken';

import type { Env } from '../config/env';

export class ExchangeCodeError extends Error {
  public readonly code: 'invalid_token' | 'wrong_audience' | 'expired';

  constructor(code: 'invalid_token' | 'wrong_audience' | 'expired', message: string) {
    super(message);
    this.name = 'ExchangeCodeError';
    this.code = code;
  }
}

export type ExchangeCodeClaims = {
  sub: string; // user id as string
  aud: 'aem-mcp';
  jti: string;
  iat: number;
  exp: number;
};

export type VerifiedExchangeCode = {
  userId: number;
  jti: string;
};

export function verifyExchangeCode(token: string, env: Env): VerifiedExchangeCode {
  let decoded: Record<string, unknown>;
  try {
    decoded = jwt.verify(token, env.MCP_OAUTH_SIGNING_KEY, {
      algorithms: ['HS256'],
      audience: 'aem-mcp',
    }) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ExchangeCodeError('expired', 'exchange code expired');
    }
    throw new ExchangeCodeError('invalid_token', 'invalid exchange code');
  }

  const sub = decoded.sub;
  const aud = decoded.aud;
  const jti = decoded.jti;
  if (typeof sub !== 'string' || aud !== 'aem-mcp' || typeof jti !== 'string') {
    throw new ExchangeCodeError('wrong_audience', 'exchange code has wrong audience or shape');
  }
  const userId = Number.parseInt(sub, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ExchangeCodeError('invalid_token', 'exchange code has invalid subject');
  }
  return { userId, jti };
}
