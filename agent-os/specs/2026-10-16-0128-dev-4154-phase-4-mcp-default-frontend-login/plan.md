# Plan — Phase 4 (mcp-default-frontend-login) [redrafted 2026-10-16-0128 v2]

> **v2 is superseded.** Follow Phase 4 Plan v3 below. Do not implement pending-user/time lookup, direct redirect to the agent's redirect_uri, or the frontend delay described in the historical plan.

## Phase 4 Plan v3

### Goal and contract

1. aem-mcp signs mcp_state containing exactly one server-owned binding selector: deviceCode for RFC 8628 or authRequestId for authorization-code + PKCE. The state also contains nonce and a server-generated mcpCallbackUri for /oauth/authorize/agent-callback. PKCE request details stay in aem-mcp's pending request store.
2. aem-frontend completes login, including 2FA, then calls /api/oauth/exchange/agent before normal post-login navigation.
3. aem-backend verifies mcp_state and session. It returns an exchange JWT with sub, aud, exactly one verified binding selector (deviceCode or authRequestId), and a stable jti derived from the signed nonce, plus mcpCallbackUri copied from the verified state. Repeating agent-bind with the same signed state therefore preserves the same binding identity.
4. Frontend redirects only to the callback URI returned by backend with the exchange code. It ignores/removes independently editable mcp_redirect_uri.
5. aem-mcp verifies the code. For device flow it approves exactly its deviceCode and renders “Device paired”. For PKCE it consumes the matching pending authRequestId, mints the authorization code using the original redirect_uri, state, client_id, and code_challenge, then redirects to the original client callback with code, state, and iss. A retry of the identical binding is idempotent; a different binding or denied, expired, missing, or already-consumed request is an error. Device clients poll /oauth/token; PKCE clients redeem the returned code with their verifier.

The MCP callback URI and the agent/client redirect_uri are distinct. Device authorization returns the browser to MCP; it must not send the exchange code directly to the agent redirect_uri. Preserve OAuth state only where the existing protocol requires it.

### Scope by repository

#### aem-backend

- Validate required deviceCode and mcpCallbackUri claims in OAuthExchangeUseCase.agentBind; accept only signed mcp_state from aem-mcp.
- Extend OAuthExchangeTokenService.sign with optional binding claims used only by agentBind. Keep regular credential exchange and exchange-by-session compatible.
- Extend exchange claims/verifier to expose optional deviceCode for legacy tokens; Phase 4 callback requires it.
- Return the verified mcpCallbackUri with agent-bind response. Update DTO/controller/use-case/token-service tests. Never log JWTs or credentials.

#### aem-mcp

- Mint mcp_state with mcpCallbackUri constructed from trusted MCP server configuration. Do not send the client's redirect_uri as the frontend callback target.
- Add agent-bind-callback.ts and GET /oauth/authorize/agent-callback. Verify exchange code, require deviceCode, and approve that exact row.
- Make retries safe only for an existing approved row with the same userId and jti. Audit only the initial state transition.
- Make device-code and authorization-code /oauth/authorize requests use the frontend bridge by default; ?bridge=0 selects the existing inline form for either flow. Keep PKCE validation and token redemption unchanged.
- Validate MCP_FRONTEND_URL scheme/base URL. If missing, return 503; do not silently use the inline form. Remove MCP_INLINE_FORM_OPT_OUT unless separately specified.

#### aem-frontend

- Add src/services/mcpAgent.js with typed expired, binding, and network errors.
- Run binding in the successful login effect/model before its normal redirect. Do not use setTimeout or assume Dva dispatch returns a completion promise.
- Preserve MCP state through the existing 2FA step. On binding failure, keep the authenticated user on a retryable screen and do not send the code elsewhere.
- Redirect only to backend-returned mcpCallbackUri. Guard duplicate bind requests and redirects.
- Existing provider login paths are supported when they return through the same successful-login hook; otherwise document them out of scope and provide the account/password path.

### Implementation order

1. Update this spec and matching date-slug mirrors in aem-backend and aem-frontend. Reconcile .ai-dlc/current-task.json with observed audit evidence and actual PR/branch state. Keep High tier and required checks.
2. Add backend contract tests for callback URI validation, deviceCode claim issuance, legacy token compatibility, and sensitive-data logging.
3. Implement backend claims/response and pass backend unit, integration, build, lint, and security checks.
4. Add MCP callback and idempotency tests, then implement callback, audit, and route registration.
5. Add frontend service/login tests, then implement binding before navigation, 2FA state continuity, retry UI, and trusted callback redirect.
6. Wire default entry points and ?bridge=0 compatibility. Keep Cursor PKCE unchanged.
7. Run each repo's required checks and manual browser/device-poll E2E. Record evidence in each PR.
8. Ship coordinated PRs in dependency order: backend contract, then MCP callback/default routing and frontend consumer. Do not enable MCP default redirect before backend and frontend contract are deployed.

### Acceptance tests

- Editing a callback query parameter cannot redirect away from the URI returned from verified mcp_state.
- Agent-bind exchange JWT contains aud=aem-mcp and valid deviceCode. Callback rejects a token missing deviceCode.
- Callback approves only the device named in the verified token.
- Repeating the same deviceCode/userId/jti succeeds without a second state transition or audit. Different user/jti and denied, expired, or missing device fail.
- Login success calls bind once before navigation. Bind failure shows retry UI and does not redirect. Login without mcp_state keeps current behavior.
- MCP bridge is default for device flow and PKCE; ?bridge=0 renders the existing inline form for both; PKCE parameters and redemption semantics are unchanged.
- Device E2E issues device code, authenticates in frontend, returns to MCP “Device paired”, then polling /oauth/token yields access token.
- PKCE E2E starts /authorize with client_id, redirect_uri, state, and S256 challenge; frontend login returns to MCP callback; callback redirects only to the stored allow-listed client URI with an authorization code; redeeming that code with the original verifier succeeds and preserves state.

### Required verification

- aem-backend: npm test, npm run tsc, npm run lint, build, and relevant API/integration tests.
- aem-mcp: npm run test:unit, npm run test:e2e, npm run build, npm run lint, npm run security:audit, and touched-code coverage.
- aem-frontend: npm test, npm run build, and npm run lint. The repository has no tsconfig.json, so its bare npm run tsc command has no configured project to check.
- All repos: manual E2E evidence and High-tier specialist review.

### Readiness and open decisions

- Previous ESC-DEV-4154-005 audit finding is stale against the observed npm run security:audit result (found 0 vulnerabilities). Record evidence and update/close through AI-DLC; do not infer PR state from old notes.
- Confirm the production MCP base URL source for mcpCallbackUri and exact API response envelope.
- Keep High tier. Do not mark ready until all three spec mirrors and AI-DLC current-task state agree.

---

## Superseded v2 plan (historical)

## File changes

### aem-mcp (1 new file, 5 modified, 2 test files)

NEW:
- src/oauth/agent-bind-callback.ts
  - Export: `makeHandleAgentBindCallback({ env, deviceCodes })`
    returning the Express handler for GET /oauth/authorize/agent-callback.
  - Reads `code` from req.query.
  - On missing → 400 text/plain "code is required".
  - try { verifyExchangeCode(code, env) } catch ExchangeCodeError
    → 400 text/html with `e.code` in an HTML comment.
  - Find pending device row by userId + recent mint time.
  - deviceCodes.approve(deviceCode, userId, jti); render success
    page inline.
  - On approve-throws-already-approved → still 200 success page
    (idempotent).
  - audit.mcpAgentBindingForwarded on success only.
- tests/unit/oauth/agent-bind-callback.test.ts
  - happy path, missing code, expired code, malformed code,
    already-approved (idempotent), approve throws.

MODIFIED:
- src/oauth/login-exchange-handler.ts
  - In the /oauth/activate handler and the device-flow branch
    of /oauth/authorize: when ?bridge=0 is present, render
    inline form; otherwise call handleRedirectToFrontend.
  - Extract the device-flow branch from /oauth/authorize into
    a small helper if it makes the dispatch easier to test.
- src/oauth/routes.ts
  - Register GET /oauth/authorize/agent-callback → new handler.
  - Existing /oauth/authorize/redirect-to-frontend route stays.
- src/oauth/views/device-authorization-page.ts
  - Add @deprecated JSDoc: "Kept for tests and ?bridge=0 opt-in.
    Default pairing uses the React app via MCP_FRONTEND_URL."
- src/config/env.ts
  - Add MCP_INLINE_FORM_OPT_OUT: z.boolean().default(false).
  - In production, log a warning at startup if MCP_FRONTEND_URL
    is unset and MCP_INLINE_FORM_OPT_OUT is false.
- src/utils/audit.ts
  - Add mcpAgentBindingForwarded({ deviceCode, userId, jti }).
    Same shape as existing audit helpers.

TESTS EXTENDED:
- tests/unit/oauth/login-exchange-handler.test.ts
  - ?bridge=0 → inline form.
  - default (no ?bridge=0) + MCP_FRONTEND_URL set → 302 to React
    app URL with mcp_state.
  - default + MCP_FRONTEND_URL unset → 503.
  - Same 3 cases for /oauth/authorize?response_type=device_code.
  - Cursor PKCE flow unaffected (existing tests unchanged).

### aem-frontend (1 new service, 1 modified page, 1 optional component, 1 test extension)

NEW:
- src/services/mcpAgent.js
  - bindMcpAgent(mcpState) POSTs /api/oauth/exchange/agent.
  - Throws: McpStateExpiredError (401), McpBindError (other
    4xx/5xx), NetworkError (fetch fail).
  - Returns { exchangeCode, expiresIn } on 200.
- src/pages/user/login/components/McpBindingBanner.jsx
  - Ant Design Alert (type="error") with e.message.

MODIFIED:
- src/pages/user/login/index.jsx
  - On mount: read mcp_state, mcp_redirect_uri from window.location.search.
  - After login dispatch resolves: await bindMcpAgent(mcp_state).
  - On success: window.location.replace(mcp_redirect_uri + '?code=' + exchangeCode).
  - On error: render <McpBindingBanner error={e} />.
- tests/login.test.jsx
  - mount with mcp_state + mcp_redirect_uri, success → replace called.
  - mount with mcp_state, bindMcpAgent rejects McpStateExpiredError
    → banner renders, no replace.
  - mount with mcp_state, bindMcpAgent rejects NetworkError
    → banner renders, no replace.
  - mount WITHOUT mcp_state → existing tests pass.

## Commands (run in order)

### aem-mcp

```bash
cd /Users/henry/Documents/Github/aem/aem-mcp
git checkout feature/DEV-4154-phase-4-mcp-default-frontend-login

# 1. Tests first (failing) — write the new test file before source.
npm test -- tests/unit/oauth/agent-bind-callback.test.ts
# expected: FAIL (module not found)

# 2. Implement agent-bind-callback.ts
# 3. Implement routes.ts changes
# 4. Implement login-exchange-handler.ts ?bridge=0 dispatch
# 5. Implement env.ts MCP_INLINE_FORM_OPT_OUT
# 6. Implement audit.mcpAgentBindingForwarded

# 7. Re-run tests
npm test
# expected: PASS (all unit tests green, target 100% on touched files)

# 8. Lint
npm run lint

# 9. Build
npm run build

# 10. Security audit (gated on ESC-DEV-4154-005 being resolved)
npm run security:audit
```

### aem-frontend

```bash
cd /Users/henry/Documents/Github/aem/aem-frontend
git checkout feature/DEV-4154-phase-4-companion-frontend

# 1. Tests first (failing)
npm run test -- tests/login.test.jsx
# expected: FAIL (McpBindingBanner / mcpAgent service missing)

# 2. Implement src/services/mcpAgent.js
# 3. Implement McpBindingBanner.jsx
# 4. Implement index.jsx mcp_state ride-along

# 5. Re-run tests
npm run test

# 6. Type check
npm run tsc

# 7. Lint
npm run lint
```

## Rollback steps (per repo)

```bash
# aem-mcp
cd /Users/henry/Documents/Github/aem/aem-mcp
git revert --no-edit <merge-commit-of-phase-4>
git push origin develop

# aem-frontend
cd /Users/henry/Documents/Github/aem/aem-frontend
git revert --no-edit <merge-commit-of-phase-4-companion>
git push origin stable
```

## Out-of-scope (do NOT do)

- Do not change /api/oauth/exchange/agent on aem-backend.
- Do not delete src/oauth/views/device-authorization-page.ts
  (still used by ?bridge=0 and Cursor strict bridge).
- Do not change the Cursor strict (authorization_code + PKCE) flow.
- Do not add new dependencies to either repo.
- Do not bypass the security:audit gate.
