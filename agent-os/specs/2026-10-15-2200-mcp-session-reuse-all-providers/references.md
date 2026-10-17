# References — MCP Session Reuse (All Providers)

**Date:** 2026-10-15-2200  
**Slug:** mcp-session-reuse-all-providers

## Plan File

- `~/.cursor/plans/update_aem-mcp_auth_to_support_all_providers_+_session_reuse_2b866a39.plan.md`

## aem-backend Files

| File | Change |
|---|---|
| `src/app/controller/OAuthExchangeController.ts` | Added `POST /api/oauth/exchange-by-session` |
| `src/domain/usecase/OAuthExchangeBySessionUseCase.ts` | New use case |
| `src/app/middleware/oauthExchangeBySessionRateLimit.ts` | New rate-limit middleware |
| `src/app/index.ts` | Wired route and middleware |

## aem-mcp Files

| File | Change |
|---|---|
| `src/clients/aem-backend-oauth-client.ts` | Added `exchangeBySession()` |
| `src/config/env.ts` | Added `MCP_BACKEND_OAUTH_EXCHANGE_BY_SESSION_URL` |
| `src/oauth/login-exchange-handler.ts` | Wrapped `GET /oauth/authorize` for session reuse |
| `src/oauth/views/device-authorization-page.ts` | Added 4 provider buttons |
| `tests/unit/oauth/aem-backend-oauth-client.test.ts` | Extended |
| `tests/unit/oauth/login-exchange-handler.test.ts` | Extended |

## Standards

- `auth/session-vs-access-token` — pre-existing
- `api/response-format` — pre-existing
- `auth/cookie-forwarding` — introduced by this spec (see `standards.md`)
