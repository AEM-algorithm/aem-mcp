import jwt from 'jsonwebtoken';

import type { Env } from '../config/env';
import type { JwtPayload, SessionContext } from './session-context';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function verifySessionToken(token: string, env: Env): SessionContext {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (!decoded?.id) {
      throw new AuthError('Session token is missing user id');
    }
    return {
      userId: decoded.id,
      email: decoded.email,
      authority: decoded.authority,
      companyId: decoded.companyId,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Invalid or expired session token');
  }
}

export function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing Bearer token');
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new AuthError('Missing Bearer token');
  }
  return token;
}
