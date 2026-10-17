# Shape — MCP Session Reuse (All Providers)

**Date:** 2026-10-15-2200  
**Slug:** mcp-session-reuse-all-providers  
**Tier:** Standard (1 reviewer)

## Scope

Enable seamless OAuth device-flow authentication across all 5 AEM MCP providers by reusing the user's existing aem-backend session instead of rendering a login form.

### Providers

| Provider | UI State |
|---|---|
| Email/Password | Live link |
| Google | Live link |
| Auth0 | Live link |
| MetaMask | Disabled (MVP) |
| Xverse | Disabled (MVP) |

MetaMask and Xverse render as disabled buttons in this iteration.

## Decisions

### Session Reuse Strategy

When `GET /oauth/authorize` is called:

1. aem-mcp forwards the incoming `Cookie: token=...` header to aem-backend's new endpoint.
2. If aem-backend returns success, aem-mcp auto-approves the `device_code` / `auth_code` without rendering a form.
3. If the session exchange fails or the cookie is absent, the existing device-authorization page renders normally.

This keeps aem-mcp stateless; aem-backend owns session validation.

### New Endpoint (aem-backend)

```
POST /api/oauth/exchange-by-session
```

- Accepts `Cookie` header (forwarded verbatim by aem-mcp).
- Returns OAuth tokens on success; 401 on invalid/missing session.
- Rate-limited per IP via `oauthExchangeBySessionRateLimit` middleware.

### New Environment Variable (aem-mcp)

```
MCP_BACKEND_OAUTH_EXCHANGE_BY_SESSION_URL
```

Default: `http://localhost:3000/api/oauth/exchange-by-session`

### Reused Secrets

- `MCP_OAUTH_SIGNING_KEY` (signs MCP tokens)
- `SESSION_SECRET` (validates backend session cookie)

No new secrets introduced.

## Constraints

- No new npm dependencies in either aem-backend or aem-mcp.
- 100% test coverage on touched files (aem-backend test rule).
- The `Cookie` header must be forwarded verbatim and must never be logged.
- MetaMask and Xverse are disabled for MVP; do not wire live flows yet.
