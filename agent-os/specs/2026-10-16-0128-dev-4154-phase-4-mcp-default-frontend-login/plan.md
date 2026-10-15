# Plan — Phase 4 (mcp-default-frontend-login) [redrafted 2026-10-16-0128 v2]

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
