# Standards — Phase 4 (mcp-default-frontend-login)

> The original v2 inline conventions below are historical where they conflict with Phase 4 Plan v4. Current contract: signed mcp_state and exchange JWT contain exactly one selector (deviceCode or authRequestId); PKCE callback redeems only the MCP-stored request parameters; frontend uses the callback URI returned from verified state; inline form uses ?bridge=0.

This spec references the standards catalog at agent-os/standards/index.yml.
Topics applied (in order of relevance):

## api

- `oauth-device-flow` — RFC 8628 device authorization grant; the existing
  aem-mcp implementation (src/oauth/device-codes.ts, src/oauth/routes.ts)
  is the source of truth. Phase 4 only changes the *user-facing* default
  entry point; the device_code grant semantics are unchanged.
- `oauth-jwt-bridge` — HS256 JWTs with shared secrets for the bridge
  between aem-mcp and aem-backend. Reuse MCP_JWT_SECRET (mcp_state) and
  MCP_OAUTH_SIGNING_KEY (exchangeCode) exactly as in Phase 3b.
- `redirect-allowlist` — redirect_uri must pass isValidRedirectUri().
  Phase 4 reuses this for the new mcp_state's redirect_uri claim and
  for the 302 Location header to the frontend.

## backend

- `layered-architecture` — new code in src/oauth/; routes.ts only wires
  handlers; no business logic in routes.
- `audit-redaction` — utils/audit redaction list must cover
  mcpState, exchangeCode, password, TOTP, session cookie.
- `env-validation` — MCP_FRONTEND_URL required in production, warn in
  dev. URL parse + scheme validation (http/https only).
- `error-handling` — typed OAuthError from src/oauth/errors.ts; never
  log secrets. RestError for unexpected 5xx.

## business

- `agent-pairing-flow` — external agents (Claude Code, Cursor, ChatGPT,
  Codex) pair via aem-mcp. Device and PKCE authorization use the React
  app bridge; PKCE validation and token redemption remain unchanged.
- `cross-repo-spec-mirror` — date-slug must match between aem-mcp and
  aem-frontend spec directories for cross-repo PRs.

## Inline conventions (only when index.yml is silent)

- 503 body for missing MCP_FRONTEND_URL is text/html, not JSON, to
  match the existing 4xx/5xx error pages in src/oauth/views/.
- audit.mcpAgentBindingForwarded reuses the same shape as
  audit.exchangeReceived and audit.deviceApproved
  (`{ event, deviceCode, userId, jti, ts }`).
- aem-frontend mcp_state ride-along runs AFTER login dispatch resolves;
  it must not delay the login UX for users without mcp_state.
