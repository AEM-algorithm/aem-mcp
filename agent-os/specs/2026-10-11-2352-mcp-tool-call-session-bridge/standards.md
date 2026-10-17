# Standards Applied — Tool-call Session Bridge

The following standards apply to this work.

---

## auth/session-vs-access-token

`src/auth/verify-session-token.ts` dispatches by JWT claim shape. Session tokens have `id: <userId-number>`; MCP access tokens have `sub`, `aud`, `jti`. We call `verifyAccessToken` to get the `jti` for the cache key.

Full reference: `src/oauth/access-token-verify.ts` — the access-token verifier.

---

## api/response-format

aem-backend wraps responses in an envelope:

```json
{
  "status": "Success" | "error",
  "data": { ... },
  "message": "...",
  "errorCode": "..."
}
```

Success: 200, parse `envelope.data.sessionToken` and `envelope.data.expiresAt`.
Error 401: read `envelope.errorCode` to distinguish `invalidCredentials` vs `twoFactorRequired` etc. For this endpoint, the only error is "access token rejected" — surface it as `AuthError`.
Error 5xx: surface as `BackendError(status, 502)`.

Reference: `src/clients/aem-backend-oauth-client.ts:90-140` — exact pattern.

---

## api/error-handling

- `AuthError` — thrown when the user's credential is invalid; handled by `handleHttpError` returning 401.
- `BackendError` — thrown when aem-backend is unreachable or returns 5xx; handled by `handleHttpError` returning 502.
- `ExchangeCodeError`-style typed errors — only used inside the bridge for clarity, but the public surface is just `AuthError` and `BackendError`.

Reference: `src/utils/error.ts`, `src/errors/backend-error.ts`, `src/server.ts:35-55`.

---

## env schema via zod

Add `MCP_BACKEND_SESSION_URL` to `src/config/env.ts` as:

```typescript
MCP_BACKEND_SESSION_URL: z.string().url().optional(),
```

Optional so the server can still boot when the companion backend PR is not yet deployed. When unset, `getSessionToken` throws `BackendError('session bridge not configured', 503)`.

---

## structured logging via src/utils/logger

Log on every cache miss and every bridge failure:

- `session_bridge_cache_hit` (jti only, no token)
- `session_bridge_fetch_ok` (jti only)
- `session_bridge_rejected` (reason, jti)
- `session_bridge_unavailable` (status, reason)

Never log the access token or session token.
