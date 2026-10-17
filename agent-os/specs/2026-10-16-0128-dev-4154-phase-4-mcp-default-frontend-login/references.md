# References — Phase 4 (mcp-default-frontend-login) [redrafted 2026-10-16-0128 v2]

> This v2 reference list is retained for history. Its lookup-by-user/time and frontend redirect descriptions are superseded by plan.md Phase 4 Plan v4 and the backend/frontend mirrors with this same date-slug.

## Prior specs (chronological)

- 2026-10-08-2353-dev-4154-aem-mcp-external-agent-auth — DEV-4154
  parent spec. Phase 3a/3b/4/5/6/7/8/9/10 ship incrementally on
  feature/DEV-4154. Phase 4 is the React-app bridge default + the
  agent-bind-callback endpoint.
- 2026-10-10-1500-auth0-login-and-mcp-proxy — Auth0 provider
  integration. Independent of Phase 4; the mcp_state ride-along is
  provider-agnostic and does not change Auth0 flow.
- 2026-10-11-2352-mcp-tool-call-session-bridge — Phase 11 (post-4).
  Builds on Phase 4's session-aware exchangeCode minting.
- 2026-10-15-2200-mcp-session-reuse-all-providers — Phase 6 bridge
  for all 5 providers. Reuses /api/oauth/exchange-by-session.
  Independent of Phase 4 (which uses /api/oauth/exchange/agent).

## Backend endpoints consumed

- POST /api/oauth/exchange/agent
  - Source: aem-backend/src/app/controller/OAuthExchangeController.ts
    (line 90, `agentBind`) and request/AgentBindDto.ts.
  - Body: { mcpState: string }.
  - Auth: Cookie: token=<session-token> (required, identifies the
    already-logged-in user).
  - 200: { exchangeCode: string, expiresIn: number }.
  - 401 invalidMcpState: mcp_state JWT expired or aud/deviceCode
    mismatch.
- POST /api/oauth/exchange (existing, used by inline form fallback)
  - Source: aem-backend/src/app/controller/OAuthExchangeController.ts
    (line ~50, `exchangeCode`).
  - Body: { mcpState: string }.
  - 200: { exchangeCode, expiresIn }.

## aem-mcp source touchpoints (Phase 4 redraft)

NEW:
- src/oauth/agent-bind-callback.ts — handler for the new
  /oauth/authorize/agent-callback endpoint. Verifies exchangeCode
  via exchange-code-verify.ts, looks up pending device row by
  userId + recent mint time, calls deviceCodes.approve(…),
  renders "Device paired" success page. Idempotent.

MODIFIED:
- src/oauth/login-exchange-handler.ts — in the /oauth/activate
  handler and the device-flow branch of /oauth/authorize:
  - When ?bridge=0 is present → render existing inline form
    (renderDeviceAuthorizationPage).
  - Otherwise → call existing handleRedirectToFrontend (the
    /oauth/authorize/redirect-to-frontend handler) to 302 to
    React app.
- src/oauth/routes.ts — register GET /oauth/authorize/agent-callback
  → new handler. Existing /oauth/authorize/redirect-to-frontend
  route stays (it's the inner implementation).
- src/oauth/views/device-authorization-page.ts — add @deprecated
  JSDoc on renderDeviceAuthorizationPage. Kept for tests and
  ?bridge=0 opt-in.
- src/config/env.ts — add MCP_INLINE_FORM_OPT_OUT (z.boolean()
  .default(false)). In production, log a warning at startup if
  MCP_FRONTEND_URL is unset and MCP_INLINE_FORM_OPT_OUT is false.
- src/utils/audit.ts — add audit.mcpAgentBindingForwarded({…}).

UNCHANGED (already in feature/DEV-4154 from Phase 3a/3b):
- src/oauth/frontend-login-handler.ts — handleRedirectToFrontend
  is the inner implementation that both /oauth/authorize/redirect-to-frontend
  and the new defaults call.
- src/oauth/exchange-code-verify.ts — verifyExchangeCode unchanged.
- src/oauth/device-codes.ts — approve(…) signature unchanged.
- src/oauth/auth-codes.ts — isValidRedirectUri unchanged.

TESTS:
- tests/unit/oauth/agent-bind-callback.test.ts (new)
- tests/unit/oauth/login-exchange-handler.test.ts (extended)

## aem-frontend source touchpoints (Phase 4 redraft)

NEW:
- src/services/mcpAgent.js — bindMcpAgent(mcpState) POSTs
  /api/oauth/exchange/agent; throws McpStateExpiredError,
  McpBindError, NetworkError.
- src/pages/user/login/components/McpBindingBanner.jsx — Ant
  Design Alert for failed bind.

MODIFIED:
- src/pages/user/login/index.jsx — read mcp_state + mcp_redirect_uri
  on mount, call bindMcpAgent after login, redirect browser to
  mcp_redirect_uri?code=exchangeCode on success.
- tests/login.test.jsx — extend with mcp_state ride-along
  scenarios (200 success, 401 expired, network error, no mcp_state).

## Open questions (resolved in redraft)

- Q: Should the default for /oauth/activate be "always 302 to React
  app, never inline form"?
  A: No. The redraft makes the bridge the default BUT preserves
  the inline form behind an explicit ?bridge=0 query flag. This
  keeps tests and operators who prefer the inline form working.
- Q: How does the agent-bind-callback handler know which device row
  to approve? exchangeCode claims are { sub: userId, jti, aud, iat, exp };
  deviceCode is not in the claims.
  A: Look up the device row by userId where status='pending' and
  createdAt >= now - MCP_STATE_TTL_SECONDS. If multiple match
  (unlikely: only one device per user can be pending at a time,
  and aem-mcp serializes), prefer the most recent.
- Q: How is the existing /oauth/authorize/redirect-to-frontend
  route affected?
  A: It stays exactly as-is. The new defaults call the SAME
  handler. The explicit route is still useful for testing and
  for the Cursor strict PKCE flow which expects it.
- Q: Local-dev fallback — inline form when MCP_FRONTEND_URL unset?
  A: Same as before — 503 text/plain. The redraft adds an
  MCP_INLINE_FORM_OPT_OUT flag for operators who want to keep the
  inline form available even when the bridge is configured.

## Open questions (unresolved — escalate if hit)

- Whether the audit.mcpAgentBindingForwarded record should also
  include the original mcp_state JTI for cross-referencing with
  the bridge entry audit. Defer to a follow-up spec.
