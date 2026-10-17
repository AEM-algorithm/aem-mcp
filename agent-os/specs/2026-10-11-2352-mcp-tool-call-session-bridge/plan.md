# Plan — Tool-call Session Bridge

## Ticket

- Spec: `agent-os/specs/2026-10-11-2352-mcp-tool-call-session-bridge/`
- Branch: `feature/DEV-4154` (current; no new branch)
- Tier: Standard (1 reviewer)
- This repo: **aem-mcp only**
- Cross-repo companion: aem-backend (out of scope for this PR; the new `POST /api/oauth/session` endpoint will be implemented there)

## Problem

When an external agent calls a tool via `POST /mcp` with `Authorization: Bearer <mcp_access_token>`, aem-mcp verifies the access token and forwards the request to aem-backend's tool API using `authToken = access_token` (line 213 in `src/server.ts`). aem-backend's tool API only accepts the Journaler session_token (signed with `SESSION_SECRET`, 15-minute TTL, contains `id`, `type: 'session'`, `currentAuthority`, `need2FA`, etc.), so every tool call returns **401**.

## Outcome

`POST /mcp` with an MCP access token succeeds against aem-backend tool APIs. aem-mcp bridges the MCP access token to a Journaler session token via a new `POST /api/oauth/session` endpoint on aem-backend, caches the session token by `jti` for the duration of its TTL, and forwards tool calls with `Cookie: token=<session_token>`.

## File changes

### New files

| File | Purpose |
|---|---|
| `src/oauth/session-bridge.ts` | `getSessionToken(accessToken, env): Promise<string>` — verify access token, fetch session token from aem-backend, cache by jti |
| `tests/unit/oauth/session-bridge.test.ts` | Test-first: cache hit, cache miss, 401 from backend, 5xx from backend, TTL expiry, malformed response |

### Modified files

| File | Change |
|---|---|
| `src/server.ts` | In the `/mcp` Bearer branch, replace `authToken = token` with `authToken = await getSessionToken(token, env)`; pass it as `Cookie: token=<authToken>` to `registerReadTools` instead of `token: authToken` (the underlying aem-backend client should send it as a cookie) |
| `src/config/env.ts` | Add `MCP_BACKEND_SESSION_URL: z.string().url().optional()` to the Zod schema |
| `.env.example` | Add `MCP_BACKEND_SESSION_URL=http://localhost:3000/api/oauth/session` |

### Out of scope (aem-backend companion PR)

- `POST /api/oauth/session` handler on aem-backend
  - Body: `{ accessToken: string }`
  - Verify HS256 JWT (MCP_OAUTH_SIGNING_KEY, aud=aem-mcp)
  - Check jti not revoked
  - Query `users` table → build session payload
  - Return `{ sessionToken, expiresAt }` (HS256, SESSION_SECRET, 15m TTL)
- Updates to aem-backend tool API to accept `Cookie: token=<session_token>`

## Sequence (test-first)

1. Add `MCP_BACKEND_SESSION_URL` to `src/config/env.ts` Zod schema.
2. Write `tests/unit/oauth/session-bridge.test.ts` (failing).
3. Implement `src/oauth/session-bridge.ts` — in-process cache `Map<jti, { sessionToken, expiresAt }>`, fetch from aem-backend on miss, return cached on hit.
4. Update `src/server.ts` — call `getSessionToken` in the Bearer branch, change `authToken` to be sent as `Cookie: token=<sessionToken>`.
5. Update `.env.example`.
6. Verify: `npm run lint && npm run test:unit && npm run build`.

## Cache design

```typescript
// src/oauth/session-bridge.ts
type CacheEntry = { sessionToken: string; expiresAt: number };
const cache = new Map<string, CacheEntry>(); // key = jti

export async function getSessionToken(
  accessToken: string,
  env: Env,
): Promise<string>;
```

- **Key:** `jti` claim from the MCP access token (one cache entry per pairing)
- **Value:** `{ sessionToken, expiresAt }` — `expiresAt` is the wall-clock time at which the session token expires; we reject cache hits that are already past expiry
- **TTL:** 15 minutes (matches aem-backend session token TTL); configured at fetch time
- **Eviction:** lazy — on cache miss or stale entry, just fetch a new one
- **Concurrency:** if two tool calls arrive simultaneously with the same `jti` and no cache entry, both will fetch; the second fetch overwrites the first. The session tokens are functionally identical (same `jti`, same user), so this is safe. A future enhancement could add a per-`jti` inflight `Promise<string>` map to dedupe, but is out of scope.

## Wire format

### aem-mcp → aem-backend

```
POST {MCP_BACKEND_SESSION_URL}
Content-Type: application/json

{ "accessToken": "<mcp_access_token_jwt>" }
```

### aem-backend → aem-mcp (success)

```json
{
  "sessionToken": "<jwt_signed_with_SESSION_SECRET>",
  "expiresAt": 1731292800000
}
```

### aem-backend → aem-mcp (failure)

- `401` → access token rejected (revoked, expired, signature invalid). aem-mcp throws `AuthError('session bridge rejected access token')`.
- `5xx` → aem-backend unreachable. aem-mcp throws `BackendError('session bridge unavailable', 502)`.

### aem-mcp → aem-backend tool API (after bridge)

```
POST /api/<tool>
Cookie: token=<session_token>
Content-Type: application/json

{ ...tool_args }
```

(Previously: `Authorization: Bearer <mcp_access_token>`. The tool API on aem-backend only accepts the cookie path.)

## Test assertions

```typescript
// tests/unit/oauth/session-bridge.test.ts
describe('session-bridge', () => {
  it('returns cached sessionToken on second call with same jti', async () => {
    // Given: cache has { sessionToken: 's1', expiresAt: future } for jti X
    // When: getSessionToken(accessTokenWithJti=X)
    // Then: returns 's1', fetch is NOT called
  });

  it('fetches new sessionToken on cache miss', async () => {
    // Given: cache empty, mock fetch returns 200 { sessionToken: 's1', expiresAt }
    // When: getSessionToken(accessTokenWithJti=X)
    // Then: fetch is called once with { accessToken }, returns 's1', cache is populated
  });

  it('refreshes cache when entry is past expiresAt', async () => {
    // Given: cache has { sessionToken: 'old', expiresAt: past } for jti X
    // When: getSessionToken(accessTokenWithJti=X)
    // Then: fetch is called, returns new sessionToken
  });

  it('throws AuthError when backend returns 401', async () => {
    // Given: mock fetch returns 401
    // When: getSessionToken(accessToken)
    // Then: throws error with code 'unauthorized' and message mentioning 'session bridge'
  });

  it('throws BackendError when backend returns 5xx', async () => {
    // Given: mock fetch returns 503
    // When: getSessionToken(accessToken)
    // Then: throws BackendError with statusCode 502, cache is NOT populated
  });

  it('throws when response is missing sessionToken', async () => {
    // Given: mock fetch returns 200 { foo: 'bar' } (no sessionToken)
    // When: getSessionToken(accessToken)
    // Then: throws BackendError
  });
});
```

```typescript
// tests/unit/server.test.ts (extend existing) — Bearer branch
describe('POST /mcp with Bearer access_token', () => {
  it('calls session-bridge and forwards Cookie: token=<sessionToken>', async () => {
    // Given: a valid MCP access_token, mocked aem-backend tool API
    // When: POST /mcp with Authorization: Bearer <access_token>
    // Then: aem-backend tool API receives Cookie: token=<bridged_session_token>
  });

  it('returns 401 when session-bridge rejects (revoked/expired)', async () => {
    // Given: a revoked MCP access_token
    // When: POST /mcp
    // Then: returns 401
  });
});
```

## Run / Verify

```bash
npm run lint
npm run test:unit
npm run build
```

## Risk

| Risk | Mitigation |
|---|---|
| aem-backend session endpoint not yet deployed | `MCP_BACKEND_SESSION_URL` is optional; if missing, log a clear startup warning and return 503 on tool calls. Cross-repo PR is companion, ships same day. |
| Cache grows unbounded | jti space is bounded by the number of active pairings (one per paired agent). Pairings are bounded by user count × 10. TTL is 15m, so even in worst case the cache is small. |
| Stale session_token after user logout on aem-backend | aem-backend tool API will return 401 on a stale session. aem-mcp can return 401 to the agent and rely on the agent re-pairing (Phase 5+). Cache invalidation on logout is out of scope. |
| Concurrent fetch races | Documented in Cache design — safe because session tokens are identical for same jti. |

## Rollback

Revert the merge commit. Remove `MCP_BACKEND_SESSION_URL` from env. The previous behavior (aem-mcp forwarding access_token as `authToken`) returns.

## Definition of Done

- [ ] `MCP_BACKEND_SESSION_URL` added to `src/config/env.ts` Zod schema
- [ ] `src/oauth/session-bridge.ts` exists with `getSessionToken` function
- [ ] `src/server.ts` Bearer branch calls `getSessionToken` and forwards as cookie
- [ ] `.env.example` documents `MCP_BACKEND_SESSION_URL`
- [ ] All test assertions pass
- [ ] `npm run lint` exits 0
- [ ] `npm run test:unit` exits 0 with new tests included
- [ ] `npm run build` exits 0
- [ ] PR description includes: outcome, assertions, evidence (`npm test` output), risk, assumptions (aem-backend session endpoint deployed), affected systems (aem-mcp only), rollback
