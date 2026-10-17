# Agent-Ready Specification — Phase 4 (mcp-default-frontend-login)

> **Superseded:** This v2 draft contains an invalid device lookup and callback flow. The working v3 contract is in plan.md under “Phase 4 Plan v3”; it takes precedence wherever this draft conflicts. Update this shape and its mirrors before implementation is marked ready.

## Phase 4 v3 corrections

- Frontend returns the exchange code to an aem-mcp callback, never directly to the agent's redirect_uri. aem-mcp creates the callback URI from trusted server configuration and includes it in signed mcp_state. aem-backend verifies that state and returns the verified callback URI; frontend must not trust an editable query parameter as its redirect target.
- Agent-bind exchange JWT must carry the verified deviceCode. aem-mcp must not infer a device from pending rows, user IDs, or timestamps.
- Frontend binding runs in the successful login path before navigation. A fixed delay after dispatch is not synchronization. Binding errors leave the authenticated user able to retry.
- Repeated approval succeeds only when the row is already approved for the same user and jti. Other states or bindings remain errors.
- Use ?bridge=0 for the inline form. Remove MCP_INLINE_FORM_OPT_OUT unless a distinct operator behavior is specified.
- The default frontend bridge covers both RFC 8628 device authorization and authorization-code + PKCE. The PKCE callback must use the pending request stored by aem-mcp; the frontend never receives or chooses the agent's redirect_uri.

## Superseded v2 shape

Everything below this heading is retained as historical context only. It is not the current implementation contract. Use Phase 4 Plan v3 and the same-date backend/frontend mirrors.

---

## Identity

- Ticket: DEV-4154, Phase 4
- Owner: agent (Cursor Assistant, AI-DLC)
- Task tier: High (inherited from parent ticket)
- Spec version: 2026-10-16-0128-dev-4154-phase-4-mcp-default-frontend-login
- Mirror: aem-frontend/agent-os/specs/2026-10-16-0128-dev-4154-phase-4-mcp-default-frontend-login/
- Backend mirror: aem-backend/agent-os/specs/2026-10-16-0128-dev-4154-phase-4-mcp-default-frontend-login/
- Branches:
  - aem-mcp: `feature/DEV-4154-phase-4-mcp-default-frontend-login` (base: `develop`)
  - aem-frontend: `feature/DEV-4154-phase-4-companion-frontend` (base: `stable`)

## Outcome

External agents (Claude Code, ChatGPT, Codex) that follow RFC 8628
device authorization land on aem-frontend's `/user/login` (the React app
the user already trusts) instead of aem-mcp's inline HTML form. After
the user signs in, aem-frontend POSTs to aem-backend's
`/api/oauth/exchange/agent`, receives an `exchangeCode`, and
`window.location.replace`s the browser to aem-mcp's new
`/oauth/authorize/agent-callback?code=<exchangeCode>` endpoint. aem-mcp
verifies the code, calls `deviceCodes.approve(...)`, and renders a
"Device paired" success page; the agent's next `POST /oauth/token` poll
returns 200 with an access token.

The inline form path (the current default) is preserved behind a query
flag `?bridge=1` for tests and operators who prefer it. The default
for new device flows is the React-app bridge.

## Context (what already exists in the codebase)

Phase 3a/3b on `feature/DEV-4154` already shipped:

- `src/oauth/frontend-login-handler.ts` — `handleRedirectToFrontend`
  looks up the device row by `user_code`, signs an HS256 `mcp_state`
  JWT (5 min TTL, claims `{ deviceCode, redirectUri, nonce }`) with
  `MCP_JWT_SECRET`, and 302-redirects to
  `${MCP_FRONTEND_URL}/user/login?mcp_state=…&mcp_redirect_uri=…&state=…`.
  - 503 when `MCP_FRONTEND_URL` is unset.
  - 400 when `user_code` invalid / not found.
  - Error redirect when `redirect_uri` fails the allow-list.
  - Wired at `GET /oauth/authorize/redirect-to-frontend` (opt-in, not default).
- `src/oauth/login-exchange-handler.ts` — `GET /oauth/authorize` and
  `GET /oauth/activate` currently render the inline HTML form
  (`renderDeviceAuthorizationPage`).
- `src/oauth/device-codes.ts` — `approve(deviceCode, userId, jti)`
  flips a row to `{ status: 'approved', userId, jti }`.
- `src/oauth/exchange-code-verify.ts` — `verifyExchangeCode(token, env)`
  returns `{ userId, jti }` on success; throws
  `ExchangeCodeError` (`invalid_token` | `wrong_audience` | `expired`).
- `src/config/env.ts` — `MCP_FRONTEND_URL: z.string().url().optional()`.
- `src/utils/audit.ts` — `audit` helper with redaction.
- aem-backend: `POST /api/oauth/exchange/agent` (OAuthExchangeController.agentBind
  at line 90, request `AgentBindDto { mcpState }`) — verifies the
  `mcp_state` JWT, reads the user from the session cookie, and
  returns `{ exchangeCode, expiresIn }`.

Phase 4 fills the **two missing pieces**: the agent callback endpoint
on aem-mcp + aem-frontend's mcp_state ride-along, and rewires the two
default entry points (`/oauth/activate` and `/oauth/authorize`
device-flow branch) to use the bridge instead of the inline form
unless the operator explicitly opts in with `?bridge=0`.

## Inputs and Outputs

### Inputs

- `MCP_FRONTEND_URL` (env, aem-mcp) — base URL of aem-frontend.
  Required in production; optional in dev (warning at startup).
- `MCP_JWT_SECRET` (env, shared aem-mcp + aem-backend) — HS256 key
  for `mcp_state` JWTs.
- `MCP_OAUTH_SIGNING_KEY` (env, aem-mcp) — HS256 key for `exchangeCode`.
- `MCP_STATE_TTL_SECONDS` (env, aem-mcp, default 300) — `mcp_state` TTL.
- `MCP_INLINE_FORM_OPT_OUT` (env, aem-mcp, default false) — when `true`,
  the inline form path is available via `?bridge=0` on
  `/oauth/activate` and the device-flow branch of `/oauth/authorize`.
- `isValidRedirectUri(redirectUri)` — existing allow-list (loopback +
  ChatGPT callback).

### Outputs

- `GET /oauth/activate?user_code=…&redirect_uri=…&state=…` →
  - When `MCP_FRONTEND_URL` is set AND `?bridge=0` is not present →
    302 to `${MCP_FRONTEND_URL}/user/login?mcp_state=<jwt>&mcp_redirect_uri=…&state=…`.
  - When `MCP_FRONTEND_URL` is unset → 503 text/plain
    "MCP_FRONTEND_URL is not configured on this server." (already
    implemented in `handleRedirectToFrontend`).
  - When `?bridge=0` is present → render the existing inline form
    (`renderDeviceAuthorizationPage`).
- `GET /oauth/authorize?response_type=device_code&user_code=…&redirect_uri=…&state=…`
  → same dispatch as `/oauth/activate` (device-flow branch only; the
  Cursor PKCE branch is untouched).
- `GET /oauth/authorize/agent-callback?code=<exchangeCode>` (new):
  - 200 text/html "Device paired" success page on success.
  - 400 text/html with explanation on `ExchangeCodeError`,
    missing `code`, or `deviceCodes.approve` failure.
  - Idempotent: a second visit after binding still renders the success
    page (does not re-consume the device row).
- `src/oauth/agent-bind-callback.ts` (new module) exports
  `makeHandleAgentBindCallback({ env, deviceCodes })` returning the
  Express handler.

## In Scope

### aem-mcp

1. **`src/oauth/agent-bind-callback.ts` (new)**
   - `makeHandleAgentBindCallback({ env, deviceCodes })`
   - Read `code` from `req.query`.
   - On missing → 400 text/plain "code is required".
   - `try { verifyExchangeCode(code, env) } catch (e: ExchangeCodeError)`
     → 400 text/html with `e.code` in a comment for debugging; no
     secret in response.
   - `deviceCodes.approve(deviceCodeFromState, userId, jti)`. The
     `deviceCode` for a successful `verifyExchangeCode` is **not** in
     the `exchangeCode` claims (sub=userId, jti=uuid). We need to
     find the device row by `userId` whose `status` is `pending` and
     that was minted within the last 5 minutes (the bridge TTL).
   - Render success page inline (mirror style of
     `views/device-authorization-page.ts`).
   - Idempotency: if `approve` is called twice (double-click, browser
     back), the second call should still render the success page
     without flipping state. Implementation: catch the
     "already approved" path and return 200.
2. **`src/oauth/routes.ts`** — register
   `GET /oauth/authorize/agent-callback` → new handler.
3. **`src/oauth/login-exchange-handler.ts`** — in the
   `GET /oauth/activate` and the device-flow branch of
   `GET /oauth/authorize`:
   - When `?bridge=0` is present, render the existing inline form.
   - Otherwise, call the existing
     `handleRedirectToFrontend(req, res)` (extract the inline-form
     rendering into a sub-step, or call the handler directly).
4. **`src/oauth/views/device-authorization-page.ts`** — add
   `@deprecated` JSDoc on `renderDeviceAuthorizationPage` pointing
   to the React app bridge (kept for tests + opt-in).
5. **`src/config/env.ts`** — add `MCP_INLINE_FORM_OPT_OUT`
   (z.boolean().default(false)). In production, if
   `MCP_FRONTEND_URL` is unset and `MCP_INLINE_FORM_OPT_OUT` is false,
   log a startup warning.
6. **`src/utils/audit.ts`** — add `audit.mcpAgentBindingForwarded({ deviceCode, userId, jti })`
   reusing the existing redaction list. Emit a single record at the
   point of `deviceCodes.approve` success.
7. **Tests**:
   - `tests/unit/oauth/agent-bind-callback.test.ts` (new):
     - happy path (200 success page, `deviceCodes.approve` called once,
       `audit.mcpAgentBindingForwarded` called once).
     - missing `code` (400).
     - expired `exchangeCode` (400, no approve).
     - malformed `exchangeCode` (400, no approve).
     - already-approved device (200 success page, second approve
       is a no-op, audit called at most once).
     - `deviceCodes.approve` throws (500 with opaque message, no
       secret leak).
   - Extend `tests/unit/oauth/login-exchange-handler.test.ts`:
     - `GET /oauth/activate` with `?bridge=0` → inline form.
     - `GET /oauth/activate` without `?bridge=0` and
       `MCP_FRONTEND_URL` set → 302 to frontend URL with mcp_state
       verifying locally.
     - `GET /oauth/activate` without `?bridge=0` and
       `MCP_FRONTEND_URL` unset → 503.
     - Same 3 cases for the device-flow branch of
       `GET /oauth/authorize`.
8. **`.env.example`** — add `MCP_INLINE_FORM_OPT_OUT=false`,
   mark `MCP_FRONTEND_URL` as required in production.

### aem-frontend

1. **`src/services/mcpAgent.js` (new)**:
   - `bindMcpAgent(mcpState)` → POSTs `/api/oauth/exchange/agent`
     with body `{ mcpState }` using the existing
     `src/services/api.js` `request` helper.
   - Throws typed errors:
     - `McpStateExpiredError` on 401 `invalidMcpState`.
     - `McpBindError` on other 4xx/5xx (with status).
     - `NetworkError` on fetch failure.
   - Returns `{ exchangeCode, expiresIn }` on 200.
2. **`src/pages/user/login/index.jsx` (modified)**:
   - On mount: read `mcp_state` and `mcp_redirect_uri` from
     `window.location.search`. Hold in `useState`.
   - After login dispatch resolves successfully and the user is on
     the page: `await bindMcpAgent(mcp_state)`. On success:
     `window.location.replace(mcp_redirect_uri + '?code=' + exchangeCode)`.
   - On error: render `<McpBindingBanner error={e} />`.
3. **`src/pages/user/login/components/McpBindingBanner.jsx`
   (new, optional)** — Ant Design `<Alert type="error">` with
   `e.message` from `bindMcpAgent`.
4. **`tests/login.test.jsx` (extended)**:
   - mount with `?mcp_state=valid_jwt&mcp_redirect_uri=https://agent/cb`,
     submit valid credentials, mock `bindMcpAgent` to resolve
     `{ exchangeCode: 'ex' }`, assert
     `window.location.replace` called once with
     `https://agent/cb?code=ex`.
   - mock `bindMcpAgent` to reject with `McpStateExpiredError` →
     `<McpBindingBanner>` renders, no `replace`.
   - mock `bindMcpAgent` to reject with `NetworkError` →
     `<McpBindingBanner>` renders, no `replace`.
   - mount without `mcp_state` → existing login tests pass, no
     `bindMcpAgent` call.

## Out of Scope

- Cursor strict (authorization_code + PKCE) flow — keeps its existing
  bridge (`/oauth/authorize/redirect-to-frontend` is one piece of
  that flow; not changed).
- New aem-backend endpoints — `/api/oauth/exchange/agent` shipped in
  Phase 6.
- Provider-specific UI (Google, Auth0, MetaMask, Xverse) — login
  page already routes.
- Refresh tokens, revocation flows.
- Hardening against phishing of the verification_uri
  (`MCP_FRONTEND_URL` is server-configured).

## Constraints

### Architecture

- aem-mcp layered: new module `src/oauth/agent-bind-callback.ts`;
  route wiring only in `src/oauth/routes.ts`; no business logic
  in `routes.ts`.
- aem-frontend: mcp_state handling lives in the existing
  `src/pages/user/login/index.jsx`; use the existing
  `src/models/login.js` Dva model for the login effect.
- No new npm dependencies.
- 100% statements / branches / functions / lines on touched files.

### Security / data

- `mcp_state` JWT: HS256 with `MCP_JWT_SECRET`,
  `MCP_STATE_TTL_SECONDS` TTL (default 5 min). Reject if expired,
  aud/deviceCode mismatched, or `redirect_uri` not allow-listed.
- `exchangeCode` JWT: HS256 with `MCP_OAUTH_SIGNING_KEY`, `aud='aem-mcp'`,
  60s TTL (existing). One-shot consumption.
- Never log `mcpState`, `exchangeCode`, password, TOTP, or session
  cookie. `utils/audit` redaction must apply.
- `MCP_FRONTEND_URL`: validate URL parses; scheme must be `http` or
  `https`; reject any value with user-controlled path components
  that could enable open-redirect.
- `isValidRedirectUri`: existing allow-list; reuse.

### Performance

- 302 redirect adds one hop. Negligible.
- Backend `/api/oauth/exchange/agent` p95 < 200 ms (existing).

### Compatibility

- Local dev: `MCP_FRONTEND_URL=http://localhost:8000` works with
  the default Umi dev server (port 8000).
- If `MCP_FRONTEND_URL` is unset: 503 (NOT a fallback to inline form
  unless `?bridge=0` is explicit).

### Protected paths (aem-mcp AI-DLC)

- `/auth/`, `.env*` — only via PR; no direct edits.
- `.ai-dlc/runtime/` — only the plugin writes; do not edit.

### Frontend rules (aem-frontend)

- No inline-disable of ESLint / Prettier.
- Boolean query params serialized explicitly before `request(...)`.
- Use the existing `src/models/login.js` Dva model.

## Test Assertions (machine-checkable)

1. Given `MCP_FRONTEND_URL` unset and `?bridge=0` not present, when
   `GET /oauth/activate?user_code=VALID` is called, then aem-mcp
   returns 503 with body containing "MCP_FRONTEND_URL is not configured".
2. Given `MCP_FRONTEND_URL=https://app.example` and a fresh device row
   for `user_code=VALID`, when `GET /oauth/activate?user_code=VALID&redirect_uri=…&state=…`
   is called, then aem-mcp 302s to
   `https://app.example/user/login?mcp_state=<jwt>&mcp_redirect_uri=…&state=…`,
   and the `mcp_state` verifies with `MCP_JWT_SECRET` and contains
   the device's `deviceCode` claim.
3. Given `MCP_FRONTEND_URL` is set and `?bridge=0` is present, when
   `GET /oauth/activate?user_code=VALID&bridge=0` is called, then
   aem-mcp renders the existing inline form HTML (no 302).
4. Given a fresh device row, when
   `GET /oauth/authorize?response_type=device_code&user_code=VALID&redirect_uri=…`
   is called, then aem-mcp 302s to the React app (same as #2).
5. Given aem-frontend mounts `/user/login?mcp_state=valid_jwt&mcp_redirect_uri=https://agent/callback`,
   and the user submits valid credentials, and `bindMcpAgent` resolves
   with `{ exchangeCode: 'EX' }`, then aem-frontend calls
   `window.location.replace('https://agent/callback?code=EX')` exactly
   once.
6. Given `bindMcpAgent` rejects with `McpStateExpiredError`, then
   `<McpBindingBanner>` renders and `window.location.replace` is not
   called.
7. Given `bindMcpAgent` rejects with `NetworkError`, then
   `<McpBindingBanner>` renders and `window.location.replace` is not
   called.
8. Given a valid `exchangeCode` JWT and a pending device row, when
   `GET /oauth/authorize/agent-callback?code=…` is called, then aem-mcp
   renders the "Device paired" success page, `deviceCodes.approve` was
   called once with the right args, and `audit.mcpAgentBindingForwarded`
   emitted one record without secrets.
9. Given the callback is visited twice (browser back), then the second
   visit renders the success page without re-flipping device state and
   the audit record is emitted at most once.
10. Given the `exchangeCode` is expired or malformed, when the
    callback fires, then aem-mcp returns 400 HTML with a clear
    message, `deviceCodes.approve` is NOT called, and no audit record
    is emitted.
11. Given `MCP_FRONTEND_URL` is `http://evil.com` and
    `MCP_INLINE_FORM_OPT_OUT=false`, when env validation runs at
    startup, then the URL is rejected (scheme allow-list or
    production-only restriction) and the server refuses to 302 to a
    non-allow-listed host.

## Required Verification

- aem-mcp:
  - `npm run lint`
  - `npm test` (target 100% on touched files)
  - `npm run build`
  - `npm run security:audit` (must clear `ESC-DEV-4154-005` first)
- aem-frontend:
  - `npm run lint`
  - `npm run tsc`
  - `npm run test`
- Manual E2E (recorded in PR description):
  1. Start aem-backend, aem-frontend (dev), aem-mcp with
     `MCP_FRONTEND_URL=http://localhost:8000`.
  2. From a scratch terminal, run
     `curl -X POST http://localhost:7000/oauth/device -d '{}'` and
     note the `user_code` + `verification_uri_complete`.
  3. Open `verification_uri_complete` in a browser, sign in via
     `/user/login`, observe the "Device paired" page, and verify
     `POST /oauth/token` from the same shell returns 200 with
     `access_token`.

## Rollback

- Revert the PR (one PR per repo). Both aem-mcp and aem-frontend
  revert independently. The opt-in bridge
  `/oauth/authorize/redirect-to-frontend` and the inline form
  remain in the prior commit.
- If the frontend change ships first but aem-mcp cannot ship, the
  frontend silently ignores `mcp_state` (no regression).

## Stop and Escalation Conditions

- aem-backend `/api/oauth/exchange/agent` is missing or returns
  shape changes (no `exchangeCode` field, wrong `aud` claim) —
  escalate; do not invent a parallel endpoint.
- aem-mcp `MCP_JWT_SECRET` not aligned with aem-backend verification
  — stop and escalate; this would break the entire bridge.
- The new default redirect makes the local-dev experience worse for
  aem-mcp maintainers (e.g. they need the frontend running to pair
  an agent) — stop and propose an env flag (`MCP_INLINE_FORM_OPT_OUT`)
  in a follow-up spec. **This flag is now in scope per request 2026-10-16.**
- `security:audit` gate (`ESC-DEV-4154-005`) unresolved — do not start
  implementation.

## Definition of Done

- [ ] All 11 assertions have evidence (test names + manual transcript
      snippets pasted in PR).
- [ ] `npm run lint`, `npm test`, `npm run tsc` green in both repos.
- [ ] `npm run build` green in aem-mcp.
- [ ] Scope, security, and risk tier unchanged from this spec.
- [ ] PR descriptions (one per repo) include: outcome, risk,
      assumptions (e.g. `MCP_FRONTEND_URL` set in production),
      affected systems, and rollback steps above.
- [ ] No secrets, no exchange codes, no TOTP, no passwords logged
      in either repo.
- [ ] Updated `.env.example` and README sections land in the same PR.
- [ ] `current-task.json` updated with `phase4DraftPr.url` after the
      PR opens.
