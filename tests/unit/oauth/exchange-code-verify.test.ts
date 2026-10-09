import jwt from 'jsonwebtoken';

import { loadEnv } from '../../../src/config/env';
import type { Env } from '../../../src/config/env';
import {
  ExchangeCodeError,
  verifyExchangeCode,
} from '../../../src/oauth/exchange-code-verify';

const ENV: Env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: '1234',
  MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
});

const OTHER_SECRET: Env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: '1234',
  MCP_OAUTH_SIGNING_KEY: 'b'.repeat(32),
});

function sign(payload: Record<string, unknown>, secret = ENV.MCP_OAUTH_SIGNING_KEY): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '60s' });
}

describe('verifyExchangeCode', () => {
  it('accepts a well-formed HS256 JWT with aud=aem-mcp', () => {
    const token = sign({ sub: '42', jti: 'j-1', aud: 'aem-mcp' });
    const out = verifyExchangeCode(token, ENV);
    expect(out.userId).toBe(42);
    expect(out.jti).toBe('j-1');
  });

  it('rejects a token signed with a different secret', () => {
    const token = sign({ sub: '42', jti: 'j-1', aud: 'aem-mcp' }, 'b'.repeat(32));
    expect(() => verifyExchangeCode(token, ENV)).toThrow(ExchangeCodeError);
    try {
      verifyExchangeCode(token, ENV);
    } catch (e) {
      expect((e as ExchangeCodeError).code).toBe('invalid_token');
    }
  });

  it('rejects a token with wrong audience', () => {
    const token = sign({ sub: '42', jti: 'j-1', aud: 'other' });
    expect(() => verifyExchangeCode(token, ENV)).toThrow(ExchangeCodeError);
    try {
      verifyExchangeCode(token, ENV);
    } catch (e) {
      expect((e as ExchangeCodeError).code).toBe('invalid_token');
    }
  });

  it('rejects an expired token with code=expired', () => {
    const token = jwt.sign(
      { sub: '42', jti: 'j-1', aud: 'aem-mcp' },
      ENV.MCP_OAUTH_SIGNING_KEY,
      { algorithm: 'HS256', expiresIn: '-1s' },
    );
    expect(() => verifyExchangeCode(token, ENV)).toThrow(ExchangeCodeError);
    try {
      verifyExchangeCode(token, ENV);
    } catch (e) {
      expect((e as ExchangeCodeError).code).toBe('expired');
    }
  });

  it('rejects a token with non-numeric subject', () => {
    const token = sign({ sub: 'not-a-number', jti: 'j-1', aud: 'aem-mcp' });
    expect(() => verifyExchangeCode(token, ENV)).toThrow(ExchangeCodeError);
  });

  it('rejects a token with no jti', () => {
    const token = sign({ sub: '42', aud: 'aem-mcp' });
    expect(() => verifyExchangeCode(token, ENV)).toThrow(ExchangeCodeError);
  });

  it('rejects a non-JWT string', () => {
    expect(() => verifyExchangeCode('not-a-jwt', ENV)).toThrow(ExchangeCodeError);
  });

  it('works with an alternate env (different signing key)', () => {
    const token = jwt.sign(
      { sub: '7', jti: 'j-2', aud: 'aem-mcp' },
      OTHER_SECRET.MCP_OAUTH_SIGNING_KEY,
      { algorithm: 'HS256', expiresIn: '60s' },
    );
    const out = verifyExchangeCode(token, OTHER_SECRET);
    expect(out.userId).toBe(7);
  });
});
