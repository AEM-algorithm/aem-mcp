// Tests for the session-bridge module.
//
// The session-bridge exchanges an MCP access token for a Journaler
// session token by calling aem-backend's POST /api/oauth/session. It
// caches the result by jti so the bridge is only hit once per session
// lifetime (15m).
//
// We use jest.mock to replace axios so we can assert on the request
// shape and stub the response without binding to a real port.

import jwt from 'jsonwebtoken';

import type { Env } from '../../../src/config/env';
import { loadEnv } from '../../../src/config/env';

const ENV: Env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: '1234',
  MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
  MCP_BACKEND_SESSION_URL: 'http://127.0.0.1:9/api/oauth/session',
});

function signAccessToken(jti: string, sub = '7'): string {
  return jwt.sign(
    { sub, jti, aud: 'aem-mcp', scope: 'aem-mcp:read' },
    ENV.MCP_OAUTH_SIGNING_KEY,
    { algorithm: 'HS256', expiresIn: '60s' },
  );
}

describe('session-bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('throws AuthError when MCP_BACKEND_SESSION_URL is not configured', async () => {
    const envNoBridge: Env = loadEnv({
      NODE_ENV: 'test',
      JWT_SECRET: '1234',
      MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
      // MCP_BACKEND_SESSION_URL intentionally omitted
    });
    const { getSessionToken } = await import('../../../src/oauth/session-bridge');
    await expect(getSessionToken(signAccessToken('j-1'), envNoBridge)).rejects.toMatchObject({
      name: 'BackendError',
    });
  });

  it('returns sessionToken and caches it on first call', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        status: 'Success',
        data: { sessionToken: 's1', expiresAt: Date.now() + 60_000 },
        message: '',
      },
    });
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { create: () => ({ post }) },
    }));

    const { getSessionToken } = await import('../../../src/oauth/session-bridge');
    const token = await getSessionToken(signAccessToken('j-cache'), ENV);
    expect(token).toBe('s1');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '',
      { accessToken: expect.stringMatching(/^ey/) },
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );
  });

  it('returns cached sessionToken without calling backend on second call (same jti)', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        status: 'Success',
        data: { sessionToken: 's1', expiresAt: Date.now() + 60_000 },
        message: '',
      },
    });
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { create: () => ({ post }) },
    }));

    const { getSessionToken } = await import('../../../src/oauth/session-bridge');
    const t1 = await getSessionToken(signAccessToken('j-cache-2'), ENV);
    const t2 = await getSessionToken(signAccessToken('j-cache-2'), ENV);
    expect(t1).toBe('s1');
    expect(t2).toBe('s1');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('fetches again when cached entry is past expiresAt', async () => {
    let now = 1_000_000_000_000;
    const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const post = jest
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 'Success',
            data: { sessionToken: 's-old', expiresAt: now + 1_000 }, // 1s from now
            message: '',
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 'Success',
            data: { sessionToken: 's-new', expiresAt: now + 60_000 },
            message: '',
          },
        });
      jest.doMock('axios', () => ({
        __esModule: true,
        default: { create: () => ({ post }) },
      }));

      const { getSessionToken } = await import('../../../src/oauth/session-bridge');
      const t1 = await getSessionToken(signAccessToken('j-ttl'), ENV);
      expect(t1).toBe('s-old');
      // advance time past expiry
      now += 5_000;
      const t2 = await getSessionToken(signAccessToken('j-ttl'), ENV);
      expect(t2).toBe('s-new');
      expect(post).toHaveBeenCalledTimes(2);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('throws AuthError when backend returns 401 (rejected access token)', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 401,
      data: { status: 'error', message: 'invalid', errorCode: 'invalidCredentials' },
    });
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { create: () => ({ post }) },
    }));

    const { getSessionToken } = await import('../../../src/oauth/session-bridge');
    await expect(getSessionToken(signAccessToken('j-401'), ENV)).rejects.toMatchObject({
      name: 'AuthError',
    });
  });

  it('throws BackendError when backend returns 5xx and does not cache', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 503,
      data: { status: 'error', message: 'down' },
    });
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { create: () => ({ post }) },
    }));

    const { getSessionToken } = await import('../../../src/oauth/session-bridge');
    await expect(getSessionToken(signAccessToken('j-503'), ENV)).rejects.toMatchObject({
      name: 'BackendError',
    });
    // No 401, but a 5xx must not leave a cache entry — the next call
    // should also hit the backend.
    await expect(getSessionToken(signAccessToken('j-503'), ENV)).rejects.toMatchObject({
      name: 'BackendError',
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('throws BackendError when response is missing sessionToken', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: { status: 'Success', data: { foo: 'bar' }, message: '' },
    });
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { create: () => ({ post }) },
    }));

    const { getSessionToken } = await import('../../../src/oauth/session-bridge');
    await expect(getSessionToken(signAccessToken('j-malformed'), ENV)).rejects.toMatchObject({
      name: 'BackendError',
    });
  });

  it('uses jti as the cache key (different jti = different cache slot)', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          status: 'Success',
          data: { sessionToken: 's-A', expiresAt: Date.now() + 60_000 },
          message: '',
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          status: 'Success',
          data: { sessionToken: 's-B', expiresAt: Date.now() + 60_000 },
          message: '',
        },
      });
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { create: () => ({ post }) },
    }));

    const { getSessionToken } = await import('../../../src/oauth/session-bridge');
    const a = await getSessionToken(signAccessToken('j-A', '7'), ENV);
    const b = await getSessionToken(signAccessToken('j-B', '7'), ENV);
    expect(a).toBe('s-A');
    expect(b).toBe('s-B');
    expect(post).toHaveBeenCalledTimes(2);
  });
});
