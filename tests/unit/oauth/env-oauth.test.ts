import { loadEnv } from '../../../src/config/env';

describe('loadEnv — OAuth foundation (Phase 3)', () => {
  it('uses a 32-byte dev signing key when MCP_OAUTH_SIGNING_KEY is unset in development', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
    });
    expect(env.MCP_OAUTH_SIGNING_KEY).toHaveLength(32);
    expect(env.OAUTH_ENABLED).toBe(true);
  });

  it('accepts an explicit MCP_OAUTH_SIGNING_KEY in development', () => {
    const key = 'a'.repeat(32);
    const env = loadEnv({ NODE_ENV: 'development', MCP_OAUTH_SIGNING_KEY: key });
    expect(env.MCP_OAUTH_SIGNING_KEY).toBe(key);
  });

  it('rejects a too-short MCP_OAUTH_SIGNING_KEY in development', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'development', MCP_OAUTH_SIGNING_KEY: 'short' }),
    ).toThrow(/MCP_OAUTH_SIGNING_KEY must be at least 32 bytes/);
  });

  it('rejects a too-short MCP_OAUTH_SIGNING_KEY in production', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-secret',
        MCP_OAUTH_SIGNING_KEY: 'short',
        MCP_FRONTEND_URL: 'https://app.example.com',
        PUBLIC_URL: 'https://mcp.example.com',
      }),
    ).toThrow(/MCP_OAUTH_SIGNING_KEY must be at least 32 bytes/);
  });

  it('requires MCP_OAUTH_SIGNING_KEY in production', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-secret',
        MCP_FRONTEND_URL: 'https://app.example.com',
        PUBLIC_URL: 'https://mcp.example.com',
      }),
    ).toThrow(/MCP_OAUTH_SIGNING_KEY is required in production/);
  });

  it('exposes all OAuth TTLs and rate limits with defaults', () => {
    const env = loadEnv({ NODE_ENV: 'development' });
    expect(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(env.OAUTH_DEVICE_CODE_TTL_SECONDS).toBe(600);
    expect(env.OAUTH_REFRESH_TOKEN_TTL_SECONDS).toBe(2_592_000);
    expect(env.OAUTH_DEVICE_POLL_INTERVAL_SECONDS).toBe(2);
    expect(env.RATE_LIMIT_OAUTH_DEVICE_PER_MIN).toBe(5);
    expect(env.RATE_LIMIT_OAUTH_TOKEN_PER_MIN).toBe(30);
  });

  it('honors explicit TTL and rate limit overrides', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      OAUTH_ACCESS_TOKEN_TTL_SECONDS: '120',
      OAUTH_DEVICE_CODE_TTL_SECONDS: '60',
      RATE_LIMIT_OAUTH_DEVICE_PER_MIN: '2',
      RATE_LIMIT_OAUTH_TOKEN_PER_MIN: '7',
    });
    expect(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(120);
    expect(env.OAUTH_DEVICE_CODE_TTL_SECONDS).toBe(60);
    expect(env.RATE_LIMIT_OAUTH_DEVICE_PER_MIN).toBe(2);
    expect(env.RATE_LIMIT_OAUTH_TOKEN_PER_MIN).toBe(7);
  });

  it('defaults OAUTH_VERIFICATION_URI to a localhost URL', () => {
    const env = loadEnv({ NODE_ENV: 'development' });
    expect(env.OAUTH_VERIFICATION_URI).toBe('http://localhost:3000/oauth/authorize');
  });

  it('respects OAUTH_ENABLED=false', () => {
    const env = loadEnv({ NODE_ENV: 'development', OAUTH_ENABLED: 'false' });
    expect(env.OAUTH_ENABLED).toBe(false);
  });

  it('respects OAUTH_ENABLED=true (string)', () => {
    const env = loadEnv({ NODE_ENV: 'development', OAUTH_ENABLED: 'true' });
    expect(env.OAUTH_ENABLED).toBe(true);
  });
});
