import jwt from 'jsonwebtoken';

import { loadEnv } from '../../../src/config/env';
import type { Env } from '../../../src/config/env';
import { AccessTokenError, verifyAccessToken } from '../../../src/oauth/access-token-verify';

const ENV: Env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: '1234',
  MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
});

const OTHER_ENV: Env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: '1234',
  MCP_OAUTH_SIGNING_KEY: 'b'.repeat(32),
});

function sign(payload: Record<string, unknown>, env = ENV): string {
  return jwt.sign(payload, env.MCP_OAUTH_SIGNING_KEY, { algorithm: 'HS256', expiresIn: '60s' });
}

describe('verifyAccessToken', () => {
  it('accepts a well-formed HS256 JWT with aud=aem-mcp', () => {
    const token = sign({ sub: '7', jti: 'j-1', aud: 'aem-mcp', scope: 'aem-mcp:read' });
    const out = verifyAccessToken(token, ENV);
    expect(out.userId).toBe(7);
    expect(out.jti).toBe('j-1');
    expect(out.scope).toBe('aem-mcp:read');
  });

  it('defaults scope to aem-mcp:read when missing', () => {
    const token = sign({ sub: '7', jti: 'j-1', aud: 'aem-mcp' });
    const out = verifyAccessToken(token, ENV);
    expect(out.scope).toBe('aem-mcp:read');
  });

  it('rejects a token signed with a different key', () => {
    const token = sign({ sub: '7', jti: 'j-1', aud: 'aem-mcp' }, OTHER_ENV);
    expect(() => verifyAccessToken(token, ENV)).toThrow(AccessTokenError);
    try {
      verifyAccessToken(token, ENV);
    } catch (e) {
      expect((e as AccessTokenError).code).toBe('invalid_token');
    }
  });

  it('rejects a token with wrong audience', () => {
    const token = sign({ sub: '7', jti: 'j-1', aud: 'aem-backend' });
    expect(() => verifyAccessToken(token, ENV)).toThrow(AccessTokenError);
    try {
      verifyAccessToken(token, ENV);
    } catch (e) {
      expect((e as AccessTokenError).code).toBe('wrong_audience');
    }
  });

  it('rejects a session-style token (id, no aud=aem-mcp)', () => {
    const token = jwt.sign({ id: 7, email: 'a@b.co' }, ENV.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '60s',
    });
    expect(() => verifyAccessToken(token, ENV)).toThrow(AccessTokenError);
  });

  it('rejects an expired token with code=expired', () => {
    const token = jwt.sign(
      { sub: '7', jti: 'j-1', aud: 'aem-mcp' },
      ENV.MCP_OAUTH_SIGNING_KEY,
      { algorithm: 'HS256', expiresIn: '-1s' },
    );
    expect(() => verifyAccessToken(token, ENV)).toThrow(AccessTokenError);
    try {
      verifyAccessToken(token, ENV);
    } catch (e) {
      expect((e as AccessTokenError).code).toBe('expired');
    }
  });

  it('rejects a token with no jti', () => {
    const token = sign({ sub: '7', aud: 'aem-mcp' });
    expect(() => verifyAccessToken(token, ENV)).toThrow(AccessTokenError);
  });

  it('rejects a token with non-numeric subject', () => {
    const token = sign({ sub: 'not-a-number', jti: 'j-1', aud: 'aem-mcp' });
    expect(() => verifyAccessToken(token, ENV)).toThrow(AccessTokenError);
  });

  it('rejects a non-JWT string', () => {
    expect(() => verifyAccessToken('garbage', ENV)).toThrow(AccessTokenError);
  });
});
