# Tool-call Session Bridge — Shaping Notes

## Scope

Bridge the gap between MCP access tokens (what external agents present at `POST /mcp`) and aem-backend's tool API, which only accepts Journaler session tokens. aem-mcp adds a session-bridge that calls a new aem-backend endpoint to exchange the access token for a session token, caches it, and forwards tool calls with `Cookie: token=<session_token>`.

## Decisions

- **Cache key = jti (not userId).** The same user may have multiple pairings (Cursor + Claude Code). Each pairing has its own jti, and a single jti should map to a single session token to keep audit trails and revocation semantics clean.
- **Cache TTL = backend-supplied expiresAt.** The backend returns the session token's wall-clock expiry; we trust it and reject cache hits that are past that time. This avoids drift between aem-mcp and aem-backend's clock on TTL.
- **In-process cache, no persistence.** Matches the existing `deviceCodes`, `pairings`, `revocation` patterns. Multi-pod is out of scope.
- **No proactive revocation listener.** When aem-backend invalidates a session (logout, security event), the aem-mcp cache may serve a stale session token for up to its TTL. The aem-backend tool API will reject the stale session with 401; aem-mcp returns 401 to the agent. Out of scope to actively invalidate.
- **No inflight dedupe in v1.** If two concurrent tool calls arrive for the same jti with no cache entry, both will fetch. Session tokens for the same jti are functionally identical, so this is safe. Can add a `Map<jti, Promise<string>>` later if it shows up in profiling.
- **aem-backend session endpoint is companion, not this PR.** The backend handler is a separate cross-repo PR. Until it ships, `MCP_BACKEND_SESSION_URL` is optional; aem-mcp returns a clear 503 on tool calls with a "session bridge not configured" error.
- **Tier: Standard.** The change is small (one new module, one server.ts edit, one env var), well-tested, and the design is the same pattern as the existing `aem-backend-oauth-client.ts` (typed errors, env-driven URL, audit logging already in place).
- **Run on current branch (`feature/DEV-4154`).** User said "don't have to create new one". The spec describes the work; the PR will be opened against this branch.

## Context

- **Visuals:** None — backend integration, no UI.
- **References:**
  - `src/clients/aem-backend-oauth-client.ts` — exact pattern to mirror (typed errors, env-driven URL, axios with `validateStatus: () => true`).
  - `src/oauth/exchange-code-verify.ts` — local JWT verification pattern (HS256, audience check, `sub` parsing).
  - `src/oauth/access-token-verify.ts` — the verifier that gives us the `jti` from the MCP access token; we call this inside `getSessionToken`.
  - `src/server.ts:213` — the `authToken = token` line that needs to change.
- **Product alignment:** This unblocks the primary use case of the entire external-agent-auth epic (DEV-4154). Without this, agents cannot actually call any tools.

## Standards Applied

- **auth/session-vs-access-token** — `verifyAccessToken` already exists and dispatches by JWT claim shape; we call it to get the jti for the cache key.
- **api/response-format** — aem-backend's response envelope is `{ status, data, message, errorCode }`; we parse it the same way `aem-backend-oauth-client.ts` does.
- **api/error-handling** — typed errors (`AuthError`, `BackendError`) flow through `handleHttpError` in `src/server.ts:35`; the new `getSessionToken` throws these.
- **Env schema via zod** — `MCP_BACKEND_SESSION_URL` follows the existing `z.string().url().optional()` pattern.

## Cross-repo coordination

aem-backend needs to ship a new endpoint `POST /api/oauth/session` in a companion PR. The contract is documented in `plan.md` (request body, response shape, error codes). Both PRs can land independently as long as the env var is not set until the backend is deployed.

## Open questions

- **Should the cache be exposed in the audit log?** Out of scope for v1, but a `session_bridge_cache_hit` event would help debugging. Defer.
- **Should we cap cache size?** No — bounded by jti space which is bounded by active pairings.
