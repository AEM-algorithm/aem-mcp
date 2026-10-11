// Session bridge — exchange an MCP access token for a Journaler session
// token by calling aem-backend's POST /api/oauth/session.
//
// Why this exists: aem-mcp's POST /mcp accepts MCP access tokens (HS256,
// signed with MCP_OAUTH_SIGNING_KEY) on the Bearer path, but aem-backend's
// tool API only accepts the Journaler session_token (HS256, signed with
// SESSION_SECRET, 15-minute TTL, sent as Cookie: token=<session_token>).
// Without this bridge, every Bearer tool call returns 401.
//
// Behavior:
//   - On first call for a given jti, POST {accessToken} to
//     MCP_BACKEND_SESSION_URL; on 200, cache the returned sessionToken
//     and its expiresAt.
//   - On subsequent calls with the same jti and a future expiresAt,
//     return the cached sessionToken without hitting the backend.
//   - On 401, throw AuthError (the access token itself is invalid).
//   - On 5xx, network error, or malformed response, throw BackendError.
//
// The cache is in-process; multi-pod is out of scope.

import axios, { type AxiosInstance } from 'axios';

import { AuthError } from '../auth/verify-session-token';
import type { Env } from '../config/env';
import { BackendError } from '../errors/backend-error';
import { logError, logInfo } from '../utils/logger';
import { verifyAccessToken } from './access-token-verify';

type CacheEntry = {
  sessionToken: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function cacheGet(jti: string): string | undefined {
  const entry = cache.get(jti);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(jti);
    return undefined;
  }
  return entry.sessionToken;
}

function cacheSet(jti: string, entry: CacheEntry): void {
  cache.set(jti, entry);
}

type Envelope = {
  status?: unknown;
  data?: { sessionToken?: unknown; expiresAt?: unknown };
  message?: unknown;
  errorCode?: unknown;
};

async function fetchSessionToken(
  http: AxiosInstance,
  accessToken: string,
): Promise<{ sessionToken: string; expiresAt: number }> {
  let response;
  try {
    response = await http.post('', { accessToken }, {
      validateStatus: () => true,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    throw new BackendError(
      `Failed to reach aem-backend session bridge: ${error instanceof Error ? error.message : 'unknown'}`,
      502,
    );
  }

  if (response.status === 200) {
    const envelope = response.data as Envelope;
    const sessionToken = envelope?.data?.sessionToken;
    const expiresAt = envelope?.data?.expiresAt;
    if (typeof sessionToken !== 'string' || typeof expiresAt !== 'number') {
      throw new BackendError('aem-backend returned malformed session response', 502);
    }
    return { sessionToken, expiresAt };
  }

  if (response.status === 401) {
    throw new AuthError('Session bridge rejected the access token');
  }

  throw new BackendError(
    `aem-backend session bridge failed with status ${response.status}`,
    502,
  );
}

export async function getSessionToken(accessToken: string, env: Env): Promise<string> {
  // 1) Verify the access token locally. This also gives us the jti.
  const claims = verifyAccessToken(accessToken, env);

  // 2) Cache hit? Return immediately.
  const cached = cacheGet(claims.jti);
  if (cached !== undefined) {
    logInfo('session_bridge_cache_hit', { jti: claims.jti });
    return cached;
  }

  // 3) Cache miss — need to call aem-backend.
  if (!env.MCP_BACKEND_SESSION_URL) {
    throw new BackendError('Session bridge is not configured (MCP_BACKEND_SESSION_URL)', 503);
  }

  const http = axios.create({
    baseURL: env.MCP_BACKEND_SESSION_URL,
    timeout: 15_000,
  });

  const { sessionToken, expiresAt } = await fetchSessionToken(http, accessToken);

  // 4) Cache for the bridge lifetime. expiresAt is a wall-clock ms; we
  //    reject hits past it via cacheGet above.
  cacheSet(claims.jti, { sessionToken, expiresAt });
  logInfo('session_bridge_fetch_ok', { jti: claims.jti });
  return sessionToken;
}

// Test-only export for cache reset. Not part of the public surface.
export function _resetSessionBridgeCacheForTests(): void {
  cache.clear();
}

// Side-effect: surface unexpected errors with context but do not
// double-log the access token (the accessToken arg is never included
// in the log call below).
logError; // referenced for side-effect import; keep import live.
