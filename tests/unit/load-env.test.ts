import { loadEnv } from '../../src/config/env';

describe('loadEnv', () => {
  it('uses dev JWT secret when JWT_SECRET is unset in development', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
    });

    expect(env.JWT_SECRET).toBe('1234');
    expect(env.PORT).toBe(3002);
    expect(env.AEM_BACKEND_URL).toBe('http://localhost:3000/api');
  });

  it('requires JWT_SECRET in production', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
      }),
    ).toThrow('JWT_SECRET is required in production');
  });

  it('accepts an explicit JWT_SECRET in production', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'prod-secret',
    });

    expect(env.JWT_SECRET).toBe('prod-secret');
  });
});
