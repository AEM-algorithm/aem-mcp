# DEV-4154 aem-mcp — Shaping Notes

## Scope

Phases 3-10 of DEV-4154, all on aem-mcp. Backend Phase 2 already done (aem-backend branch `feature/DEV-4154-external-agent-auth`, commit `edeb6837`).

## Decisions (made during shaping, not in ticket)

1. **Token revocation storage: in-process `Map<jti, revokedAt>`.** Matches D3 pattern (in-process + filesystem backup). Out-of-scope decision avoided Redis.
2. **Single `MCP_OAUTH_SIGNING_KEY` for both `exchange_code` and `access_token`.** D2 locks one signing key. Two-secret would be cleaner but isn't ticket-locked, and would complicate `verify-session-token.ts` dispatch.
3. **Dispatch in `verify-session-token.ts` by claim shape, not by token type header.** Session token has `id: <userId-number>`; MCP access token has `sub: <userId-string>` + `aud: "aem-mcp"`. Cheaper than adding a new `token_type` field.
4. **No new `OauthController` class.** OAuth is a router, not a controller class. Matches existing `src/server.ts` style (inline routers for sub-paths).
5. **Catastrophic rollback via `OAUTH_ENABLED=false` env flag.** Short-circuits OAuth routes to 503 if hardening fails in production.

## Constraints (from user during shaping)

- **Tier:** High (matches backend slice, security-sensitive).
- **PR strategy:** 1 PR / phase, 8 PRs total. Each PR reviewable and revertable independently.
- **Execution scope for this run:** Task 1 only (save spec). Implementation runs separately per phase.

## Context

### Visuals

None provided. The "Sign in with Journaler" form is a simple HTML form; we will reuse existing CSS classes from `src/views/` (if any) or write minimal inline CSS.

### References

- In-repo:
  - `src/auth/verify-session-token.ts` — JWT verify pattern to extend
  - `src/server.ts` — Express wiring pattern
  - `src/config/env.ts` — Zod env schema pattern
  - `src/clients/aem-backend-client.ts` — Axios wrapper pattern
  - `tests/e2e/mcp-http.test.ts` — supertest e2e pattern
- Cross-repo (aem-backend):
  - `src/app/controller/OAuthExchangeController.ts` — request/response contract
  - `src/app/controller/request/OAuthExchangeDto.ts` — DTO shape
  - `src/domain/usecase/OAuthExchangeUseCase.ts` — what aem-mcp can rely on
  - `src/infrastructure/service/OAuthExchangeTokenService.ts` — JWT claim shape
- Standards (defined in this spec):
  - `api/response-format` — JSON envelope
  - `api/error-handling` — `OAuthError` class
  - `auth/session-vs-access-token` — dual-path dispatch rule

### Product alignment

No `agent-os/product/` folder exists. Skipped per shape-spec command step 4. The aem-backend spec (`aem-backend/agent-os/specs/2026-10-06-2247-dev-4154-external-agent-auth/`) was used as a structural reference.

## Standards applied (added to `agent-os/standards/index.yml`)

| Standard | Why |
|----------|-----|
| `api/response-format` | All OAuth routes return `{ ok, data, error }` envelope, same as existing REST |
| `api/error-handling` | `OAuthError` extends existing error-class pattern in `src/errors/` |
| `auth/session-vs-access-token` | Formal rule for `verify-session-token.ts` dispatch by claim shape |

## Open questions deferred to next refinement

- Whether ChatGPT custom MCP connector supports RFC 8628 polling natively (we assume yes; if no, Phase 9 docs will note workaround)
- Whether `device-codes-backup.json` should also back up `pairings` + `revocation` (recommend yes; deferred to Phase 3 implementation decision)
- Whether to add `OAUTH_ENABLED=false` flag in Phase 3 (recommend yes for catastrophic rollback; currently only in rollback section)
