# Plan — MCP Session Reuse (All Providers)

**Date:** 2026-10-15-2200  
**Slug:** mcp-session-reuse-all-providers

## File Changes

### aem-backend

**New files:**
- `src/domain/usecase/OAuthExchangeBySessionUseCase.ts` — validates session, returns OAuth tokens
- `src/app/middleware/oauthExchangeBySessionRateLimit.ts` — per-IP rate limiter
- `tests/unit/domain/usecase/OAuthExchangeBySessionUseCase.test.ts`
- `tests/unit/app/middleware/oauthExchangeBySessionRateLimit.test.ts`

**Modified files:**
- `src/app/controller/OAuthExchangeController.ts` — adds `POST /api/oauth/exchange-by-session`
- `src/app/index.ts` — wires the new route and middleware

**Extended test files:**
- `tests/unit/app/controller/OAuthExchangeController.test.ts`

### aem-mcp

**New files:**
- (none)

**Modified files:**
- `src/clients/aem-backend-oauth-client.ts` — adds `exchangeBySession()` method
- `src/config/env.ts` — adds `MCP_BACKEND_OAUTH_EXCHANGE_BY_SESSION_URL`
- `src/oauth/login-exchange-handler.ts` — wraps `GET /oauth/authorize` to attempt session reuse
- `src/oauth/views/device-authorization-page.ts` — adds 4 provider buttons (Auth0 live, Google live, MetaMask/Xverse disabled)

**Extended test files:**
- `tests/unit/oauth/aem-backend-oauth-client.test.ts`
- `tests/unit/oauth/login-exchange-handler.test.ts`

## Run / Verify

### aem-backend
```bash
npm test
# Expect: 100% coverage on new files

npx tsc --noEmit
npm run lint
```

### aem-mcp
```bash
npm run test:unit

npx tsc --noEmit
npm run lint
```
