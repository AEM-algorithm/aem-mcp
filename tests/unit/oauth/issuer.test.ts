import jwt from 'jsonwebtoken';

import { ISSUER_ALGORITHM, ISSUER_AUDIENCE, createIssuer, decodeUnsafe } from '../../../src/oauth/issuer';
import { OAuthError } from '../../../src/oauth/errors';

const KEY = 'a'.repeat(32);
const OTHER_KEY = 'b'.repeat(32);

function signCode(
  payload: Record<string, unknown>,
  key = KEY,
  ttlSeconds = 60,
): string {
  // Use jwt.sign's built-in iat handling. The payload may include `sub`,
  // `aud`, `jti`. We set `exp` relative to now via expiresIn.
  return jwt.sign(payload, key, {
    algorithm: ISSUER_ALGORITHM,
    expiresIn: ttlSeconds,
  });
}

describe('createIssuer — access token (sign + verify round-trip)', () => {
  it('mints a JWT that verifies with matching claims', () => {
    const issuer = createIssuer({ signingKey: KEY });
    const { token, claims } = issuer.signAccessToken({ userId: 390 });

    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const verified = issuer.verifyAccessToken(token);
    expect(verified.sub).toBe(claims.sub);
    expect(verified.aud).toBe(ISSUER_AUDIENCE);
    expect(verified.jti).toBe(claims.jti);
    expect(verified.iat).toBe(claims.iat);
    expect(verified.exp).toBe(claims.exp);
    expect(verified.scope).toBe(claims.scope);
  });

  it('uses HS256 algorithm', () => {
    const issuer = createIssuer({ signingKey: KEY });
    const { token } = issuer.signAccessToken({ userId: 1 });
    const header = jwt.decode(token, { complete: true })?.header;
    expect(header?.alg).toBe(ISSUER_ALGORITHM);
  });

  it('generates a unique jti for each token', () => {
    const issuer = createIssuer({ signingKey: KEY });
    const a = issuer.signAccessToken({ userId: 1 });
    const b = issuer.signAccessToken({ userId: 1 });
    expect(a.claims.jti).not.toEqual(b.claims.jti);
  });

  it('honors a custom TTL (seconds)', () => {
    const issuer = createIssuer({ signingKey: KEY });
    const now = () => 1_700_000_000_000;
    const { claims } = issuer.signAccessToken({ userId: 1, ttlSeconds: 60, now });
    expect(claims.exp - claims.iat).toBe(60);
  });

  it('uses a 3600s default TTL', () => {
    const issuer = createIssuer({ signingKey: KEY });
    const now = () => 1_700_000_000_000;
    const { claims } = issuer.signAccessToken({ userId: 1, now });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('respects a custom accessTokenTtlSeconds on the issuer', () => {
    const issuer = createIssuer({ signingKey: KEY, accessTokenTtlSeconds: 120 });
    const now = () => 1_700_000_000_000;
    const { claims } = issuer.signAccessToken({ userId: 1, now });
    expect(claims.exp - claims.iat).toBe(120);
  });

  it('encodes userId as string in sub (RFC 7519 §4.1.2)', () => {
    const issuer = createIssuer({ signingKey: KEY });
    const { claims } = issuer.signAccessToken({ userId: 42 });
    expect(claims.sub).toBe('42');
  });
});

describe('createIssuer — verifyAccessToken failures', () => {
  const issuer = createIssuer({ signingKey: KEY });

  it('rejects a token signed with a different key', () => {
    const other = createIssuer({ signingKey: OTHER_KEY });
    const { token } = other.signAccessToken({ userId: 1 });
    expect(() => issuer.verifyAccessToken(token)).toThrow(OAuthError);
  });

  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = jwt.sign(
      {
        sub: '1',
        aud: ISSUER_AUDIENCE,
        jti: 'expired-jti',
        iat: past,
        exp: past + 60,
        scope: 'aem-mcp:read',
      },
      KEY,
      { algorithm: ISSUER_ALGORITHM, noTimestamp: true },
    );
    expect(() => issuer.verifyAccessToken(token)).toThrow(/access token expired/);
  });

  it('rejects a token with the wrong audience', () => {
    const token = jwt.sign(
      {
        sub: '1',
        aud: 'someone-else',
        jti: 'j',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        scope: 'aem-mcp:read',
      },
      KEY,
      { algorithm: ISSUER_ALGORITHM, noTimestamp: true },
    );
    expect(() => issuer.verifyAccessToken(token)).toThrow(/audience/);
  });

  it('rejects a token missing required claims', () => {
    const token = jwt.sign(
      { aud: ISSUER_AUDIENCE, jti: 'j' }, // no sub, no exp, no scope
      KEY,
      { algorithm: ISSUER_ALGORITHM, noTimestamp: true },
    );
    expect(() => issuer.verifyAccessToken(token)).toThrow(/wrong claim shape/);
  });

  it('rejects a malformed token (not a JWT)', () => {
    expect(() => issuer.verifyAccessToken('not-a-jwt')).toThrow(OAuthError);
  });
});

describe('createIssuer — exchange code verification (aem-backend → aem-mcp)', () => {
  const issuer = createIssuer({ signingKey: KEY });

  it('accepts a code with { sub, aud, jti, iat, exp }', () => {
    const code = signCode({
      sub: '42',
      aud: ISSUER_AUDIENCE,
      jti: 'ec-1',
    });
    const claims = issuer.verifyExchangeCode(code);
    expect(claims.sub).toBe('42');
    expect(claims.jti).toBe('ec-1');
    expect(claims.aud).toBe(ISSUER_AUDIENCE);
  });

  it('rejects a code with the wrong audience', () => {
    const code = signCode({
      sub: '42',
      aud: 'someone-else',
      jti: 'ec-1',
    });
    try {
      issuer.verifyExchangeCode(code);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      expect((err as OAuthError).code).toBe('access_denied');
    }
  });

  it('rejects a code signed with a different key', () => {
    const code = signCode({ sub: '42', aud: ISSUER_AUDIENCE, jti: 'ec-1' }, OTHER_KEY);
    expect(() => issuer.verifyExchangeCode(code)).toThrow(OAuthError);
  });

  it('rejects an expired code', () => {
    // Sign with a negative expiresIn so the lib computes exp in the past.
    const code = signCode(
      { sub: '42', aud: ISSUER_AUDIENCE, jti: 'ec-1' },
      KEY,
      -3600,
    );
    expect(() => issuer.verifyExchangeCode(code)).toThrow(/exchange_code expired|access_denied/);
  });

  it('rejects a code missing sub/jti/exp', () => {
    const code = jwt.sign(
      { aud: ISSUER_AUDIENCE }, // only aud
      KEY,
      { algorithm: ISSUER_ALGORITHM, expiresIn: 60 },
    );
    expect(() => issuer.verifyExchangeCode(code)).toThrow(/wrong claim shape/);
  });
});

describe('decodeUnsafe', () => {
  it('returns the payload without verifying signature', () => {
    const issuer = createIssuer({ signingKey: KEY });
    const { token } = issuer.signAccessToken({ userId: 7 });
    const payload = decodeUnsafe(token);
    expect(payload.sub).toBe('7');
    expect(payload.aud).toBe(ISSUER_AUDIENCE);
  });

  it('throws on a malformed token', () => {
    expect(() => decodeUnsafe('not-a-jwt')).toThrow(/malformed/);
  });
});
