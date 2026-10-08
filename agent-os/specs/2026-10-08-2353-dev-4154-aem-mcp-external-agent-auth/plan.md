# DEV-4154 aem-mcp — External Agent Authentication (RFC 8628)

## Identity

- **Ticket:** [DEV-4154](https://app.clickup.com/t/14zervyrhwj) — Allow for AI agent to connect to Journaler (Claude Code, ChatGPT, Codex, Cursor)
- **Owner:** agent (Cursor Assistant, AI-DLC); Henry + Tuan Hoang as High-tier reviewers
- **Task tier:** High
- **Spec version:** 2026-10-08-2353-dev-4154-aem-mcp-external-agent-auth
- **Cross-repo backend spec version:** 2026-10-06-2247-dev-4154-external-agent-auth (aem-backend, committed in `edeb6837`)

## Outcome

A Journaler user can run any of {Claude Code, ChatGPT custom MCP, Codex, Cursor} as an external agent, connect it to their own Journaler account via aem-mcp using RFC 8628 Device Authorization Grant, and ask read-only questions about their transactions, summaries, and calculations. The chatbot cookie/session path keeps working unchanged.

## Context

### Why RFC 8628

Headless / input-constrained clients (CLI agents, ChatGPT custom connectors) cannot do interactive browser redirects. The user runs the agent, the agent displays a `user_code` + `verification_uri`; the user opens that URL in any browser, sees a real "Sign in with Journaler" form, approves; the agent polls and receives a short-lived MCP access token.

### Cross-repo state (as of 2026-10-08)

- **aem-backend:** Phase 2 done on `feature/DEV-4154-external-agent-auth` (commit `edeb6837`). Exposes `POST /api/oauth/exchange` returning `{exchangeCode, expiresIn: 60}`. The `exchange_code` is an HS256 JWT with `aud: aem-mcp`, 60s TTL, signed by `MCP_OAUTH_SIGNING_KEY`.
- **aem-mcp (this repo):** Phase 1 (this spec) now. Phases 3-10 are implementation.

### Architecture (high level)

```
External Agent  -->  POST /oauth/device       -->  aem-mcp
aem-mcp         -->  device_code + verify_uri
User            -->  opens verify_uri in browser
aem-mcp view    -->  "Sign in with Journaler" (email + password, optional 2FA)
aem-mcp         -->  POST /api/oauth/exchange --> aem-backend
aem-mcp         -->  binds exchange_code to device_code, mints access_token
Agent           -->  polls POST /oauth/token, receives JWT
Agent           -->  POST /mcp  Authorization: Bearer <access_token>
aem-mcp         -->  verifies JWT (aud=aem-mcp, jti not revoked, exp not past)
aem-mcp         -->  calls aem-backend REST APIs on the user's behalf
```

### Locked decisions (from ticket)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Login UX | Real email + password (and 2FA) login page on aem-mcp |
| D2 | Access-token signing | HS256, separate signing key (`MCP_OAUTH_SIGNING_KEY`) |
| D3 | Device-code store | In-process `Map` + filesystem backup |
| D4 | Scopes | Auto-grant `aem-mcp:read` on first approval |
| D5 | Token rotation | 1h access token, no refresh; re-pair on expiry |
| D6 | Audit logging | Structured logs for issued/approved/exchanged/revoked/call |
| D7 | Rate limiting | 30/min on `/oauth/token`, 5/min on `/oauth/device` |

### Shaping decisions (this spec)

- **Token revocation storage:** In-process `Map<jti, revokedAt>` (matches D3 pattern, avoids new infra). Multi-pod is out of scope.
- **JWT claim shape for MCP access token:** `{sub: <userId-string>, aud: "aem-mcp", jti: <uuid>, iat, exp, scope: "aem-mcp:read"}` — distinct from current session token (`id: <userId-number>`) so `verify-session-token.ts` can dispatch.
- **Exchange_code vs access_token separation:** exchange_code (60s) is single-use bridge between aem-backend credential check and aem-mcp; access_token (1h) is what the agent uses to call `/mcp`. Two different secrets would be cleaner but ticket locks D2 to a single `MCP_OAUTH_SIGNING_KEY`.
- **Per-tool scopes:** out of scope. One scope `aem-mcp:read` only.

## Inputs and Outputs

### New files (aem-mcp)

```
src/oauth/
  device-codes.ts          # in-process Map + filesystem backup
  issuer.ts                # RFC 8628 §4.1 + §4.2 response shapes
  routes.ts                # POST /oauth/device, POST /oauth/token
  scopes.ts                # 'aem-mcp:read' constant + helpers
  pairings.ts              # in-process Map of approved device_code <-> user_id
  revocation.ts            # in-process Map<jti, revokedAt>
  errors.ts                # OAuthError class
  connected-agents-routes.ts        # GET /api/agents, DELETE /api/agents/:jti
  connected-agents-use-case.ts      # list + revoke
  views/
    device-authorization-page.ts    # HTML form "Sign in with Journaler"
    approval-success.ts             # HTML "Device paired" landing
  login-exchange-handler.ts         # POST form -> backend -> verify -> bind

src/clients/
  aem-backend-oauth-client.ts       # thin Axios wrapper for /api/oauth/exchange

src/auth/
  revocation-check.ts               # check jti in revocation map

tests/
  unit/oauth/...                    # 100% coverage on all new files
  e2e/oauth-device-flow.test.ts     # full RFC 8628 polling flow
  e2e/oauth-mcp-call.test.ts        # agent -> /mcp with access_token

docs/
  EXTERNAL_AGENT_CONNECTORS.md      # copy-paste config for 4 agents
```

### Modified files (aem-mcp)

```
src/server.ts                       # mount /oauth/* + /api/agents
src/auth/verify-session-token.ts    # dual-path: session token vs MCP access token
src/config/env.ts                   # add MCP_OAUTH_SIGNING_KEY, OAUTH_* TTLs
src/utils/logger.ts                 # add 6 oauth event types
.env.example                        # 4 new env vars
Dockerfile                          # volume for device-codes-backup.json
README.md                           # add "External Agent Authentication" section
docs/SETUP_AND_CHATBOT_INTEGRATION.md   # note OAuth is alternative path
```

### Inputs (HTTP shape)

#### `POST /oauth/device` (RFC 8628 §3.1)

Request: `{}` (no body, accepts optional `client_id` and `scope` — out of scope here)

Response 200:
```json
{
  "device_code": "<opaque>",
  "user_code": "WDDD-AB23",
  "verification_uri": "https://aem-mcp/oauth/authorize",
  "expires_in": 600,
  "interval": 2
}
```

#### `POST /oauth/token` (RFC 8628 §3.4)

Request: `{ "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "..." }`

Response 200: `{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600, "scope": "aem-mcp:read" }`

Response 400 (RFC 8628 §3.5): `{ "error": "authorization_pending" | "expired_token" | "access_denied" }`

#### `GET /oauth/authorize?user_code=...` (HTML form)

Renders "Sign in with Journaler" form.

#### `POST /oauth/authorize` (form POST)

Body: `email`, `password`, optional `totpCode`, `user_code`
- Calls aem-backend `POST /api/oauth/exchange`
- Verifies returned `exchange_code` JWT locally (same `MCP_OAUTH_SIGNING_KEY`, `aud: aem-mcp`, not expired)
- Binds `device_code` <-> `user_id`, sets status `approved`
- Renders approval-success page

#### `GET /api/agents` (cookie or MCP access token auth)

Response: `{ "data": [{ "jti": "...", "client_id": "claude-code", "approvedAt": "..." }] }`

#### `DELETE /api/agents/:jti`

Response: `{ "data": { "revoked": true } }`. Adds jti to revocation map.

## In Scope

- All 8 phases of aem-mcp work (Phases 3-10 of the ticket)
- 1 PR / phase, 8 PRs total
- 100% test coverage on all new source files
- 2 reviewers (Henry + Tuan Hoang) per PR
- E2E smoke test against local aem-backend + aem-mcp
- Connector docs (Claude Code, ChatGPT, Codex, Cursor)
- Audit log events for all 6 event types

## Out of Scope

- Multi-pod scaling (in-process state is not shared; would need Redis)
- RS256 / JWKS (sticking with HS256 + shared secret per D2)
- Per-tool scopes (only `aem-mcp:read` per D4)
- Refresh tokens (D5: 1h access, re-pair on expiry)
- "Connected agents" UI in Journaler frontend (revocation API exposed; UI is follow-up)
- Production deployment (this slice ends at local E2E + PR ready)
- ChatGPT App Store / Applications registration (Phase 9 publishes configs; submission is ops)

## Constraints

### Architecture

- Must integrate with existing `src/auth/verify-session-token.ts` dispatch — do not fork into parallel auth pipeline.
- Must reuse `src/clients/aem-backend-client.ts` patterns (Axios + error wrapping) for new `aem-backend-oauth-client.ts`.
- Express router pattern matches existing `src/server.ts` style.

### Security/data

- `MCP_OAUTH_SIGNING_KEY` MUST be ≥ 32 bytes; rejected at startup otherwise. Same value as aem-backend's `MCP_OAUTH_SIGNING_KEY`.
- Uniform error messages on `/oauth/authorize` POST (no email-enumeration oracle).
- Rate limit (D7) checked BEFORE calling aem-backend to prevent backend CPU DoS.
- `jti` revocation check is mandatory for every `/mcp` call.
- Audit log MUST NOT log: `password`, `totpCode`, full `access_token`, full `exchange_code`. May log: user_id, ip, prefix of access_token (first 16 chars).
- `device-codes-backup.json` filesystem backup MUST be chmod 600.

### Performance

- `/oauth/device` p95 < 50ms (in-process Map only).
- `/oauth/token` p95 < 100ms (1 backend call + 1 verify + 1 sign).
- `/mcp` p95 < 200ms when MCP access token is valid (same as current `/mcp` with session token).

### Compatibility

- Chatbot cookie/session path must keep working unchanged. Verified by existing `tests/e2e/mcp-http.test.ts` plus new regression test in Phase 7.
- aem-backend `POST /api/oauth/exchange` response shape is the contract; if it changes, this spec is invalid.

### Protected paths

This work touches `**/auth/**` (config.json protected path). Approval required:
- Approver: Henry
- Recorded in `.ai-dlc/current-task.json` `sandbox.protectedPathApprovals[]`

## Dependencies and Affected Systems

### External (aem-backend)

- `POST /api/oauth/exchange` — request `{email, password, totpCode?}` → response `{exchangeCode, expiresIn}`. Contract frozen in aem-backend `edeb6837`.
- `MCP_OAUTH_SIGNING_KEY` env var — must be same value in both repos.

### Internal (aem-mcp)

- `src/auth/verify-session-token.ts` — extended in Phase 5
- `src/server.ts` — extended in Phase 3 + 4
- `src/config/env.ts` — extended in Phase 3
- `src/utils/logger.ts` — extended in Phase 8
- `src/errors/` — new `OAuthError` class in Phase 3
- `src/clients/` — new `aem-backend-oauth-client.ts` in Phase 4

### Infrastructure

- Docker: add volume mount for `/app/data/device-codes-backup.json`
- CI: existing `ci-cd.yml` covers unit + e2e; new e2e file `oauth-*.test.ts` runs in same pipeline

## Test Assertions

### Phase 3 (OAuth core)

- Given no device_code store, when `POST /oauth/device` is called, then response 200 with `device_code`, `user_code` matching `/^[A-Z0-9]{4}-[A-Z0-9]{4}$/`, `expires_in: 600`, `interval: 2`
- Given a device_code is issued, when `POST /oauth/token` is called within 600s with status `issued`, then response 400 with `error: "authorization_pending"`
- Given 6+ `POST /oauth/device` calls from same IP within 60s, then 7th returns 429
- Given 31+ `POST /oauth/token` calls from same IP within 60s, then 32nd returns 429
- Given a `device-codes` Map, when process restarts after filesystem backup write, then Map is restored

### Phase 4 (Login exchange)

- Given form POST with valid email + password, when aem-backend returns `exchangeCode`, then aem-mcp verifies locally and binds to `device_code`
- Given form POST with valid email + wrong password, when aem-backend returns 401, then aem-mcp renders form error "Invalid email or password"
- Given form POST with 2FA-enabled user and no `totpCode`, when aem-backend returns 401 `twoFactorRequired`, then form re-renders with TOTP field
- Given `exchangeCode` JWT with wrong audience, when aem-mcp verifies, then bind fails with 400 `access_denied`

### Phase 5 (Token verification)

- Given request to `/mcp` with session cookie, then resolves to user via existing session path (regression)
- Given request to `/mcp` with `Authorization: Bearer <access_token>`, then resolves to user via new path
- Given request with `Authorization: Bearer <access_token>` whose `jti` is in revocation map, then 401
- Given request with `Authorization: Bearer <access_token>` with wrong `aud`, then 401

### Phase 6 (Connected-agents API)

- Given user A has 3 pairings, when `GET /api/agents` authenticated as A, then response lists 3
- Given user A has pairing P1, when `DELETE /api/agents/:jti-of-P1` as A, then 200 and jti is in revocation map
- Given user A tries to `DELETE /api/agents/:jti-of-user-B-pairing`, then 404 (not found to A)

### Phase 7 (Tests)

- All unit tests pass with 100% coverage on new files
- `npm run test:unit` exit 0
- `npm run test:e2e` exit 0 (existing 5 + new ~4-5)
- `npm run test:coverage` reports ≥ 95% on `src/oauth/**` and `src/auth/revocation-check.ts`

### Phase 8 (Hardening)

- Startup with `MCP_OAUTH_SIGNING_KEY` < 32 bytes → process exits with non-zero
- All 6 audit log event types emitted in correct flow
- Dockerfile `VOLUME` declaration for backup file
- CSP, X-Frame-Options DENY headers on OAuth pages

### Phase 9 (Docs)

- `docs/EXTERNAL_AGENT_CONNECTORS.md` has 4 sections (Claude Code, ChatGPT, Codex, Cursor) with copy-paste config blocks
- README "External Agent Authentication" section links to the new doc

### Phase 10 (E2E smoke)

- Full flow script: agent → device → user login form → token → mcp call → 200, all evidence logged in `.ai-dlc/evidence/dev-4154-mcp/e2e.log`

## Required Verification

Per `docs/ai-dlc/verification-policy.md` row "Payment/auth" (closest match for OAuth):

| Suite | Command | Block on failure |
|-------|---------|------------------|
| Build | `npm run build` | Yes |
| Lint/type | `npm run lint` + `npm run build` (tsc) | Yes |
| Unit | `npm run test:unit` | Yes |
| Integration | `npm run test:unit` (existing) + new `tests/integration/oauth/` | Yes |
| E2E | `npm run test:e2e` (including new `oauth-*.test.ts`) | Yes |
| Security | `npm run security:audit` | Yes |
| Coverage | `npm run test:coverage` (≥ 95% on touched files) | Yes |

Evidence recorded at:
- `.ai-dlc/evidence/dev-4154-mcp/jest-unit.log`
- `.ai-dlc/evidence/dev-4154-mcp/jest-coverage.log`
- `.ai-dlc/evidence/dev-4154-mcp/jest-e2e.log`
- `.ai-dlc/evidence/dev-4154-mcp/verification.md`
- `.ai-dlc/evidence/dev-4154-mcp/e2e.log` (Phase 10)

## Rollback

### Per PR (recommended)

Each phase ships as a separate PR. To rollback Phase N:

1. Revert PR commit on `develop` (or main).
2. Re-deploy previous container image.
3. No data migration needed — in-process state is ephemeral; persistent state is `device-codes-backup.json` which can be deleted.

### Full feature rollback

1. Revert all 8 PRs in reverse order (Phase 10 → 3).
2. Set `MCP_OAUTH_SIGNING_KEY=""` in `.env.example` and `.env`.
3. Remove `docs/EXTERNAL_AGENT_CONNECTORS.md` (or mark deprecated).
4. Re-deploy.

### Catastrophic (if audit log or rate limit is broken)

1. Set `OAUTH_ENABLED=false` env var (new flag, added in Phase 3) to short-circuit OAuth routes to 503.
2. Re-deploy; existing chatbot/session path keeps working.

## Stop and Escalation Conditions

Per `.ai-dlc/config.json` `limits`: `maxRuntimeMinutes: 45`, `maxRetries: 3`, `maxFilesChanged: 20` (per task).

Plus spec-specific:

- **Tier change:** if user reclassifies work as Prohibited mid-flight, stop and report.
- **Backend contract change:** if aem-backend changes `POST /api/oauth/exchange` response shape, stop and re-shape.
- **Reviewer unavailable:** if Tuan Hoang cannot review in 48h, escalate to Henry for reassignment.
- **Test weakening:** never weaken a test to obtain green. Stop and create escalation.
- **Scope expansion:** if Phase 3 reveals need for RS256/JWKS (out of scope D2), stop and re-shape.

Escalation route: structured escalation in `.ai-dlc/escalation.md` using `docs/ai-dlc/escalation-template.md`, ping Henry via Slack.

## Definition of Done

For each of the 8 PRs:

- [ ] All test assertions above have evidence in `.ai-dlc/evidence/dev-4154-mcp/`
- [ ] `npm run build`, `npm run test:unit`, `npm run test:e2e`, `npm run security:audit` pass locally
- [ ] Coverage ≥ 95% on `src/oauth/**` and `src/auth/revocation-check.ts`
- [ ] 2 reviewers approved (Henry + Tuan Hoang) in ClickUp
- [ ] CI green
- [ ] PR description includes: outcome, assertions, commands+results, risk tier, affected systems, assumptions, security notes, rollback
- [ ] Scope and risk tier remain valid (no in-flight reclassification)

## PR / Phase mapping

| PR | Phase | Title | Approx files |
|----|-------|-------|--------------|
| #1 | 3 | OAuth core (device store, RFC 8628 routes, pairings) | 6 new + 3 modified |
| #2 | 4 | Login exchange wiring (form, handler, backend client) | 4 new + 2 modified |
| #3 | 5 | Token verification (dual session vs MCP access) | 2 new + 1 modified |
| #4 | 6 | Connected-agents API (list + revoke) | 2 new + 1 modified |
| #5 | 7 | Cross-cutting tests | 1 new directory |
| #6 | 8 | Hardening (audit log, env validation, Docker, headers) | 1 new + 4 modified |
| #7 | 9 | Connector docs | 1 new + 2 modified |
| #8 | 10 | E2E smoke | 1 new + evidence |

## References

See `references.md` for pointers to in-repo files and aem-backend contract.
