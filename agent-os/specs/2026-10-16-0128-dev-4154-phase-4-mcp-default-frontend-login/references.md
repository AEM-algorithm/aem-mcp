# References — Phase 4 (mcp-default-frontend-login)

## Prior specs (chronological)

- 2026-10-08-2353-dev-4154-aem-mcp-external-agent-auth — DEV-4154
  parent spec. Phase 3a/3b/4/5/6/7/8/9/10 ship incrementally on
  feature/DEV-4154. Phase 4 is the login exchange layer.
- 2026-10-10-1500-auth0-login-and-mcp-proxy — Auth0 provider
  integration. Independent of Phase 4; provider-agnostic mcp_state
  ride-along does not change Auth0 flow.
- 2026-10-11-2352-mcp-tool-call-session-bridge — Phase 11 (post-4).
  Builds on Phase 4's session-aware exchangeCode minting.
- 2026-10-15-2200-mcp-session-reuse-all-providers — Phase 6 bridge
  for all 5 providers. Reuses /api/oauth/exchange-by-session.
  Independent of Phase 4 (which uses /api/oauth/exchange/agent).

## Backend endpoints consumed

- POST /api/oauth/exchange/agent
  - Source: aem-backend/src/app/controller/OAuthExchangeController.ts
    (line 79-104) and request/AgentBindDto.ts.
  - Body: { mcpState: string }.
  - Auth: Cookie: token=<session-token> (required, identifies the
    already-logged-in user).
  - Response 200: { exchangeCode: string, expiresIn: number }.
  - Response 401 invalidMcpState: mcp_state JWT expired or
    aud/deviceCode mismatch.

## aem-mcp source touchpoints

- src/oauth/login-exchange-handler.ts — modify (302 + 503).
- src/oauth/agent-bind-callback.ts — new.
- src/oauth/routes.ts — register agent-callback route.
- src/oauth/frontend-login-handler.ts — already mints mcp_state JWTs;
  no change.
- src/oauth/exchange-code-verify.ts — already verifies exchangeCode;
  no change.
- src/oauth/device-codes.ts — already approves devices; no change.
- src/oauth/views/device-authorization-page.ts — keep (Cursor strict),
  deprecate in JSDoc.
- src/config/env.ts — MCP_FRONTEND_URL required in prod.
- src/utils/audit.ts — add mcpAgentBindingForwarded.

## aem-frontend source touchpoints

- src/pages/user/login/index.jsx — add mcp_state ride-along.
- src/models/login.js — use existing login effect (no change).
- src/services/mcpAgent.js — new.
- src/pages/user/login/components/McpBindingBanner.jsx — new.

## Open questions (resolved)

- Q: Should the Cursor strict (PKCE) flow also redirect to the
  React app?
  A: No. The Cursor strict flow keeps its existing bridge; only the
  device flow defaults to the React app. Cursor has its own PKCE
  verifier; touching it is out of scope.
- Q: Local-dev fallback — inline form when MCP_FRONTEND_URL unset?
  A: No. 503 instead. Maintainers run npm run start:dev in
  aem-frontend to pair. This keeps a single source of truth for
  login UI.
- Q: aem-frontend test approach — mock network or real dev server?
  A: jest.mock('@/services/mcpAgent') for all 3 paths
  (200, 401 expired, network error). No MSW, no real dev server.

## Open questions (unresolved — escalate if hit)

- Whether MCP_INLINE_FORM_FALLBACK env flag should be added in a
  follow-up spec to preserve a local-dev escape hatch. Defer to
  after Phase 4 ships.
