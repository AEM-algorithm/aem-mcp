# Agent-Ready Specification — Phase 4 (mcp-default-frontend-login)

## Identity

- Ticket: DEV-4154 (Phase 4)
- Owner: agent (Cursor Assistant, AI-DLC)
- Task tier: High (inherited from parent ticket; 2 reviewers: henry, tuan-hoang)
- Spec version: 2026-10-16-0128-dev-4154-phase-4-mcp-default-frontend-login
- Mirror date-slug: 2026-10-16-0128-dev-4154-phase-4-mcp-default-frontend-login
  - aem-mcp: agent-os/specs/2026-10-16-0128-dev-4154-phase-4-mcp-default-frontend-login/
  - aem-frontend: agent-os/specs/2026-10-16-0128-dev-4154-phase-4-mcp-default-frontend-login/

## Outcome

When an external agent (Claude Code / Cursor / Codex / ChatGPT) requests
device authorization from aem-mcp, the user is always redirected to the
existing /user/login page of aem-frontend (no inline aem-mcp form, no manual
"Login with Journaler" button). After the user logs in via the React app and
is bound to the device, the agent's POST /oauth/token poll succeeds and the
user returns control to their agent. If MCP_FRONTEND_URL is unset, aem-mcp
returns 503 with a clear message (no inline-form fallback).

## Context

Phase 3a/3b shipped the OAuth foundation (errors, scopes, pairings, device
codes, revocation, issuer, rate-limit, routes) on feature/DEV-4154-phase-3a
(merged 2026-10-09). Phase 4 of the same ticket is the login exchange layer
that ties aem-mcp's device flow to aem-frontend's existing /user/login page.

Pre-existing pieces to reuse (no new aem-backend endpoint required):

- aem-backend: POST /api/oauth/exchange/agent (OAuthExchangeController.agentBind)
  accepts { mcpState }, verifies the JWT signed with MCP_JWT_SECRET, reads the
  user from the session cookie, and returns { exchangeCode, expiresIn }.
- aem-mcp: src/oauth/frontend-login-handler.ts mints mcp_state JWTs (HS256,
  5-min TTL, carries deviceCode + redirectUri + nonce) when aem-frontend hits
  the opt-in bridge.
- aem-mcp: src/oauth/exchange-code-verify.ts verifies the exchangeCode JWT
  minted by aem-backend (HS256, MCP_OAUTH_SIGNING_KEY, aud='aem-mcp').

Phase 4 changes the **default entry point** of device authorization so
external agents stop at the React app instead of an inline HTML form.

## Inputs and Outputs

### Inputs

- MCP_FRONTEND_URL (env, aem-mcp) — base URL of aem-frontend. Required in
  production; optional in dev with a startup warning.
- MCP_JWT_SECRET (env, shared aem-mcp + aem-backend) — HS256 key for
  mcp_state JWTs.
- MCP_OAUTH_SIGNING_KEY (env, aem-mcp) — HS256 key for exchangeCode verify.
- MCP_STATE_TTL_SECONDS (env, aem-mcp, default 300) — mcp_state TTL.
- isValidRedirectUri(redirect_uri) helper (existing, aem-mcp).

### Outputs

- GET /oauth/authorize?response_type=device_code → 302 to
  ${MCP_FRONTEND_URL}/user/login?mcp_state=<jwt>&mcp_redirect_uri=…&state=…
  (device flow only; the Cursor strict authorization_code+PKCE flow keeps
  its existing bridge).
- GET /oauth/activate?user_code=… → 302 to the same URL (this is the
  verification_uri passed to agents).
- GET /oauth/authorize/agent-callback?code=<exchangeCode> → verifies
  exchangeCode, binds the device, returns the "Device paired" success
  page; the agent's next POST /oauth/token poll returns 200.
- When MCP_FRONTEND_URL is unset: 503 with text/html body
  "MCP_FRONTEND_URL is not configured. Set MCP_FRONTEND_URL to enable
  agent pairing." and a Retry-After: 60 header.

## In Scope

1. aem-mcp — src/oauth/login-exchange-handler.ts: replace the inline-form
   rendering path with a 302 redirect when MCP_FRONTEND_URL is set; 503
   otherwise. Keep the existing email/password validation in the
   "POST /oauth/authorize" body handler (used by tests and legacy
   direct-form calls) but document it as a fallback.
2. aem-mcp — src/oauth/agent-bind-callback.ts (new): handler for
   GET /oauth/authorize/agent-callback. Verifies exchangeCode via
   exchange-code-verify.ts, calls deviceCodes.approve(deviceCode, userId,
   jti), renders a "Device paired" success page.
3. aem-mcp — src/oauth/routes.ts: register
   GET /oauth/authorize/agent-callback route. Add a 302 path in the
   GET /oauth/authorize handler for the device_flow response_type.
4. aem-mcp — src/oauth/views/device-authorization-page.ts: keep the file
   (Cursor strict bridge still uses it) but mark it
   `@deprecated` in JSDoc with a pointer to the new default.
5. aem-mcp — src/config/env.ts: mark MCP_FRONTEND_URL required in
   production; emit a warning at startup if unset in dev.
6. aem-mcp — src/utils/audit.ts: add audit.mcpAgentBindingForwarded()
   that records { deviceCode, userId, jti, ts } without secrets.
7. aem-frontend — src/services/mcpAgent.js (new): function
   bindMcpAgent(mcpState) POSTs /api/oauth/exchange/agent and returns
   { exchangeCode, expiresIn } on 200 or throws typed errors for
   401, 4xx, 5xx, network.
8. aem-frontend — src/pages/user/login/index.jsx: read mcp_state +
   mcp_redirect_uri from the URL query, hold in component state, after
   login (any provider) call bindMcpAgent(mcpState) and on success
   window.location.replace(mcp_redirect_uri + '?code=' + exchangeCode).
9. aem-frontend — src/pages/user/login/components/McpBindingBanner.jsx
   (new, optional): inline error banner for expired mcp_state or
   network failure.
10. Tests:
    - aem-mcp tests/unit/oauth/login-exchange-handler.test.ts: extend
      with 302 redirect + 503 cases.
    - aem-mcp tests/unit/oauth/agent-bind-callback.test.ts (new):
      happy path, expired code, malformed code, already-bound device.
    - aem-frontend tests/login.test.jsx: extend with mcp_state ride-along
      using jest.mock('@/services/mcpAgent') — three paths
      (200 success, 401 expired, network error).
11. Env docs: aem-mcp/.env.example marks MCP_FRONTEND_URL required in
    production. aem-frontend/README.md adds a "Agent pairing callback"
    section.

## Out of Scope

- Cursor strict (authorization_code + PKCE) flow — keeps its existing
  bridge (src/oauth/views/device-authorization-page.ts still used).
- New aem-backend endpoints — /api/oauth/exchange/agent already shipped
  in Phase 6.
- Provider-specific UI in aem-frontend (Google, Auth0, MetaMask, Xverse)
  — login page already routes.
- Refresh tokens, revocation flows.
- Hardening against phishing of the verification_uri (MCP_FRONTEND_URL
  is server-configured; users don't type it).

## Constraints

### Architecture

- aem-mcp layered: new code in src/oauth/ (router + handler modules).
  No business logic in routes.ts.
- aem-frontend: mcp_state handling lives in src/pages/user/login/ (the
  existing page component). Use the existing src/models/login.js Dva
  model effects; do not bypass the model.

### Security/data

- mcp_state JWT: HS256 with MCP_JWT_SECRET, MCP_STATE_TTL_SECONDS TTL
  (default 5 min). Reject if expired, aud/deviceCode mismatched, or
  redirect_uri not allow-listed.
- exchangeCode JWT: HS256 with MCP_OAUTH_SIGNING_KEY, aud='aem-mcp',
  expiresIn 60s (existing). One-shot consumption.
- Never log mcpState, exchangeCode, password, TOTP, or session cookie.
  utils/audit redaction must apply.
- MCP_FRONTEND_URL: validate URL parses; scheme must be http or https;
  reject any value with user-controlled path components that could
  enable open-redirect.
- isValidRedirectUri: existing allow-list; reuse.

### Performance

- 302 redirect adds one hop. Negligible.
- Backend /api/oauth/exchange/agent already p95 < 200 ms.

### Compatibility

- Local dev: MCP_FRONTEND_URL=http://localhost:8000 works with the
  default Umi dev server (port 8000).
- If MCP_FRONTEND_URL missing: 503 (NOT a fallback to inline form).

### Protected paths (aem-mcp AI-DLC)

- **/auth/**, .env* — only via PR; no direct edits.
- .ai-dlc/runtime/ — only the plugin writes; do not edit.

### Frontend rules (aem-frontend)

- No inline-disable of ESLint / Prettier; run npm run lint before commit.
- Boolean query params must be serialized explicitly
  (!!params.withFee = !!params.withFee) before request(...).
- Use the existing src/models/login.js Dva model for the login effect;
  the mcp_state ride-along is post-login only.

## Dependencies and Affected Systems

- aem-backend: /api/oauth/exchange/agent (existing, no change).
- aem-mcp:
  - src/oauth/login-exchange-handler.ts (modified)
  - src/oauth/agent-bind-callback.ts (new)
  - src/oauth/routes.ts (modified)
  - src/oauth/views/device-authorization-page.ts (deprecated in JSDoc)
  - src/config/env.ts (modified)
  - src/utils/audit.ts (extended)
  - tests/unit/oauth/login-exchange-handler.test.ts (extended)
  - tests/unit/oauth/agent-bind-callback.test.ts (new)
- aem-frontend:
  - src/services/mcpAgent.js (new)
  - src/pages/user/login/index.jsx (modified)
  - src/pages/user/login/components/McpBindingBanner.jsx (new, optional)
  - tests/login.test.jsx (extended)

## Test Assertions

1. Given MCP_FRONTEND_URL is unset, when GET /oauth/authorize is called
   with response_type=device_code, then aem-mcp returns 503 with the
   message "MCP_FRONTEND_URL is not configured…".
2. Given MCP_FRONTEND_URL=https://app.example and a fresh device_code,
   when GET /oauth/authorize?response_type=device_code is called, then
   aem-mcp 302s to
   https://app.example/user/login?mcp_state=<jwt>&mcp_redirect_uri=…&state=…
   and the Location header's mcp_state verifies with the public
   MCP_JWT_SECRET, contains the deviceCode, and has TTL ≤ 5 min.
3. Given aem-mcp receives
   GET /oauth/activate?user_code=ABCD-1234, when the user_code is valid
   and MCP_FRONTEND_URL is set, then aem-mcp 302s to
   ${MCP_FRONTEND_URL}/user/login?mcp_state=… (same shape as #2).
4. Given aem-frontend is at /user/login?mcp_state=…&mcp_redirect_uri=…
   and the user submits valid email/password credentials, when login
   succeeds and bindMcpAgent returns 200, then aem-frontend calls
   window.location.replace(mcp_redirect_uri + '?code=' + exchangeCode)
   exactly once and the test asserts mcpAgent.bindMcpAgent was called
   once with the original mcpState.
5. Given bindMcpAgent returns 401 invalidMcpState, when the user
   finishes login, then aem-frontend renders the McpBindingBanner
   ("This pairing request has expired. Please return to your agent to
   restart.") and does NOT navigate.
6. Given aem-mcp receives
   GET /oauth/authorize/agent-callback?code=<exchangeCode>, when
   exchange-code-verify returns a valid (userId, jti) and the device
   row is still pending, then aem-mcp binds the device, renders
   "Device paired" success page, and a subsequent POST /oauth/token
   for that device_code returns 200 with an access_token.
7. Given the exchange code is expired, malformed, or the device row is
   already bound, when the callback fires, then aem-mcp renders a 400
   HTML page with a clear message and does NOT consume the device row
   a second time.
8. Given the bridge URL is visited twice (browser back), when the
   second visit happens after binding, then aem-mcp renders the
   "Device paired" success page without re-binding (idempotent).
9. Given MCP_FRONTEND_URL=http://evil.com is somehow injected, when
   aem-mcp reads it at startup, then env validation rejects the value
   (scheme must be http/https) and refuses to 302 to a non-allow-listed
   host.

## Required Verification

- aem-mcp:
  - npm run lint
  - npm test (≥ 90% statements/branches/functions/lines on touched
    files; target 100%)
  - npm run build
  - npm run security:audit (must clear ESC-DEV-4154-005 first)
- aem-frontend:
  - npm run lint
  - npm run tsc
  - npm run test
- Manual E2E (recorded in PR description):
  1. Start aem-backend, aem-frontend (dev), aem-mcp with
     MCP_FRONTEND_URL=http://localhost:8000.
  2. From a scratch terminal, run
     curl -X POST http://localhost:7000/oauth/device -d '{}' and note
     the user_code + verification_uri_complete.
  3. Open verification_uri_complete in a browser, sign in via
     /user/login, observe the "Device paired" page, and verify
     POST /oauth/token from the same shell returns 200 with
     access_token.

## Rollback

- Revert the PR (one PR per repo). Both aem-mcp and aem-frontend
  revert independently. The previous opt-in bridge
  /oauth/authorize/redirect-to-frontend and the inline form
  remain in the prior commit.
- If the frontend change ships first but aem-mcp cannot ship, the
  frontend silently ignores mcp_state (no regression).

## Stop and Escalation Conditions

- aem-backend /api/oauth/exchange/agent is missing or returns shape
  changes (no exchangeCode field, wrong aud claim) — escalate; do not
  invent a parallel endpoint.
- aem-mcp MCP_JWT_SECRET not aligned with aem-backend verification
  (regression of the JWT verifier) — stop and escalate; this would
  break the entire bridge.
- The new default redirect makes the local-dev experience worse for
  aem-mcp maintainers (e.g. they need the frontend running to pair
  an agent) — stop and propose an env flag (MCP_INLINE_FORM_FALLBACK)
  in a follow-up spec.
- security:audit gate (ESC-DEV-4154-005) unresolved — do not start
  implementation.

## Definition of Done

- [ ] All 9 assertions have evidence (test names + manual transcript
      snippets pasted in PR).
- [ ] npm run lint, npm test, npm run tsc green in both repos.
- [ ] npm run build green in aem-mcp.
- [ ] Scope, security, and risk tier unchanged from this spec.
- [ ] PR descriptions (one per repo) include: outcome, risk,
      assumptions (e.g. MCP_FRONTEND_URL set in production),
      affected systems, and rollback steps above.
- [ ] No secrets, no exchange codes, no TOTP, no passwords logged
      in either repo.
- [ ] Updated .env.example and README sections land in the same PR.
- [ ] current-task.json updated with phase4DraftPr.url after the PR
      opens.
