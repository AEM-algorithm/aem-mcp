# Plan — Phase 4 (mcp-default-frontend-login)

## File changes

### aem-mcp (1 new file, 5 modified, 2 new test files)

NEW:
- src/oauth/agent-bind-callback.ts
  - Export: handleAgentBindCallback(req, res, deps) → Promise<void>
  - Reads `code` from req.query, verifies via exchangeCodeVerify().
  - On success: deviceCodes.approve(deviceCode, userId, jti), render
    "Device paired" success page (inline HTML, mirrors style of
    device-authorization-page.ts).
  - On error: 400 HTML with explanation. Never logs code.
- tests/unit/oauth/agent-bind-callback.test.ts
  - happy path, expired code, malformed code, already-bound device,
    missing code param, audit.mcpAgentBindingForwarded called once.

MODIFIED:
- src/oauth/login-exchange-handler.ts
  - Add early branch: if (response_type === 'device_code' ||
    req.path === '/oauth/activate') and MCP_FRONTEND_URL is set,
    return 302 Location to
    `${MCP_FRONTEND_URL}/user/login?mcp_state=${encodeURIComponent(jwt)}&mcp_redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`.
  - If MCP_FRONTEND_URL is unset, return 503 with explanatory
    text/html + Retry-After: 60.
  - Keep the existing POST /oauth/authorize body handler (legacy +
    test).
- src/oauth/routes.ts
  - Register `GET /oauth/authorize/agent-callback` → handleAgentBindCallback.
  - In GET /oauth/authorize (device flow), call the new redirect branch
    before rendering any form.
- src/oauth/views/device-authorization-page.ts
  - Add `@deprecated` JSDoc note: "Use the React app via
    MCP_FRONTEND_URL. Kept only for the Cursor strict PKCE bridge."
- src/config/env.ts
  - In production, MCP_FRONTEND_URL is required; in dev, emit a
    warning at startup if missing.
- src/utils/audit.ts
  - Add `mcpAgentBindingForwarded(deviceCode, userId, jti)` that
    emits a structured audit event with the same redact-list as
    other audit functions.

TESTS EXTENDED:
- tests/unit/oauth/login-exchange-handler.test.ts
  - Existing tests for POST /oauth/authorize stay.
  - New: GET /oauth/authorize with response_type=device_code +
    MCP_FRONTEND_URL set → 302 to expected URL.
  - New: GET /oauth/authorize + MCP_FRONTEND_URL unset → 503.
  - New: GET /oauth/activate + valid user_code + MCP_FRONTEND_URL
    set → 302.

### aem-frontend (1 new service, 1 modified page, 1 optional component, 1 test extension)

NEW:
- src/services/mcpAgent.js
  - Export: `bindMcpAgent(mcpState)` → Promise<{ exchangeCode, expiresIn }>.
  - Uses existing src/services/api.js request helper or fetch.
  - Throws: `McpStateExpiredError` (401 invalidMcpState),
    `McpBindError` (other 4xx/5xx), `NetworkError`.
- src/pages/user/login/components/McpBindingBanner.jsx (optional)
  - Renders an Alert (Ant Design) with error.message from
    bindMcpAgent.

MODIFIED:
- src/pages/user/login/index.jsx
  - On mount: read URLSearchParams for mcp_state, mcp_redirect_uri.
  - Hold in useState.
  - After successful login dispatch: await
    src/services/mcpAgent.bindMcpAgent(mcp_state), on success
    `window.location.replace(mcp_redirect_uri + '?code=' +
    result.exchangeCode)`, on error render McpBindingBanner.
- tests/login.test.jsx
  - Existing tests untouched.
  - New: mount with mcp_state + mcp_redirect_uri in URL, mock
    `@/services/mcpAgent` to return success → assert
    `window.location.replace` called with the callback URL.
  - New: mock bindMcpAgent to reject with McpStateExpiredError
    → assert banner renders, no navigation.
  - New: mock bindMcpAgent to reject with NetworkError → assert
    banner renders, no navigation.

## Commands (run in order)

### aem-mcp

```bash
cd /Users/henry/Documents/Github/aem/aem-mcp
git checkout -b feature/DEV-4154-phase-4-mcp-default-frontend-login develop

# 1. Tests first (failing) — write the new test file before the source.
#    src/oauth/agent-bind-callback.ts does not exist yet.
npm test -- tests/unit/oauth/agent-bind-callback.test.ts
# expected: FAIL (module not found)

# 2. Implement agent-bind-callback.ts
# 3. Implement routes.ts changes
# 4. Implement login-exchange-handler.ts 302 branch
# 5. Implement env.ts MCP_FRONTEND_URL required + dev warning
# 6. Implement audit.mcpAgentBindingForwarded

# 7. Re-run tests
npm test
# expected: PASS (all unit tests green)

# 8. Lint
npm run lint
# expected: PASS

# 9. Build
npm run build
# expected: PASS

# 10. Security audit (gated on ESC-DEV-4154-005 being resolved)
npm run security:audit
# expected: 0 critical, 0 high (or approved waiver)
```

### aem-frontend

```bash
cd /Users/henry/Documents/Github/aem/aem-frontend
git checkout -b feature/DEV-4154-phase-4-companion-frontend develop

# 1. Tests first (failing) — extend tests/login.test.jsx
npm run test -- tests/login.test.jsx
# expected: FAIL (McpBindingBanner does not exist yet)

# 2. Implement src/services/mcpAgent.js
# 3. Implement McpBindingBanner.jsx
# 4. Implement index.jsx mcp_state ride-along

# 5. Re-run tests
npm run test
# expected: PASS

# 6. Type check
npm run tsc
# expected: PASS

# 7. Lint
npm run lint
# expected: PASS
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
  (Cursor strict bridge still uses it).
- Do not change the Cursor strict (authorization_code + PKCE) flow.
- Do not add new dependencies to either repo.
- Do not bypass the security:audit gate.
