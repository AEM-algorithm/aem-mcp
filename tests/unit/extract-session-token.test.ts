import { AuthError, extractSessionToken } from '../../src/auth/verify-session-token';

describe('extractSessionToken', () => {
  it('reads bearer token from authorization header', () => {
    const token = extractSessionToken({
      authorization: 'Bearer abc.def.ghi',
    });
    expect(token).toBe('abc.def.ghi');
  });

  it('reads token from cookie header', () => {
    const token = extractSessionToken({
      cookie: 'other=1; token=cookie-token; path=/',
    });
    expect(token).toBe('cookie-token');
  });

  it('throws when no auth is provided', () => {
    expect(() => extractSessionToken({})).toThrow(AuthError);
  });
});
