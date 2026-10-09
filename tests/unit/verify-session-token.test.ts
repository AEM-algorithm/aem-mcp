import type { Env } from '../../src/config/env';
import { verifySessionToken } from '../../src/auth/verify-session-token';

describe('verifySessionToken', () => {
  // The session-token verifier only reads JWT_SECRET; the other Env
  // fields are added in later phases. We cast to keep this test focused.
  const env = {
    JWT_SECRET: 'test-secret',
  } as unknown as Env;

  it('returns session context for a valid token', () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: 390, email: 'user@example.com' }, env.JWT_SECRET);

    const session = verifySessionToken(token, env);

    expect(session).toEqual({
      userId: 390,
      email: 'user@example.com',
      authority: undefined,
      companyId: undefined,
    });
  });

  it('throws for an invalid token', () => {
    expect(() => verifySessionToken('not-a-token', env)).toThrow('Invalid or expired session token');
  });
});
