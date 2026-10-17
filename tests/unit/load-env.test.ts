import { loadEnv } from '../../src/config/env';

describe('loadEnv', () => {
  it('uses dev JWT secret when JWT_SECRET is unset in development', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
    });

    expect(env.JWT_SECRET).toBe('1234');
    expect(env.PORT).toBe(3000);
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
      MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
      MCP_JWT_SECRET: 'a'.repeat(32),
      MCP_FRONTEND_URL: 'https://app.example.com',
      PUBLIC_URL: 'https://mcp.example.com',
    });

    expect(env.JWT_SECRET).toBe('prod-secret');
    expect(env.MCP_JWT_SECRET).toBe('a'.repeat(32));
  });

  it('requires MCP_JWT_SECRET in production', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-secret',
        MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
        MCP_FRONTEND_URL: 'https://app.example.com',
        PUBLIC_URL: 'https://mcp.example.com',
        // MCP_JWT_SECRET deliberately omitted
      }),
    ).toThrow('MCP_JWT_SECRET is required in production');
  });

  it('requires frontend and public MCP URLs in production', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'prod-secret',
      MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
      MCP_JWT_SECRET: 'b'.repeat(32),
    })).toThrow('MCP_FRONTEND_URL is required in production');

    expect(() => loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'prod-secret',
      MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
      MCP_JWT_SECRET: 'b'.repeat(32),
      MCP_FRONTEND_URL: 'https://app.example.com',
    })).toThrow('PUBLIC_URL is required in production');
  });

  it('rejects non-HTTP frontend base URLs and path-based destinations', () => {
    expect(() => loadEnv({ NODE_ENV: 'test', MCP_FRONTEND_URL: 'javascript:alert(1)' }))
      .toThrow();
    expect(() => loadEnv({ NODE_ENV: 'test', MCP_FRONTEND_URL: 'https://app.example.com/login' }))
      .toThrow('MCP_FRONTEND_URL must be an http(s) base URL');
  });
});
