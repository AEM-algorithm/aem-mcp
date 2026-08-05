import { verifySessionToken } from '../../src/auth/verify-session-token';

describe('verifySessionToken', () => {
  const env = {
    PORT: 3000,
    NODE_ENV: 'test' as const,
    AEM_BACKEND_URL: 'http://localhost:3000/api',
    JWT_SECRET: 'test-secret',
  };

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
