# References for DEV-4154 aem-mcp OAuth

## In-repo (aem-mcp)

### Auth

- `src/auth/verify-session-token.ts` — JWT verify using `jsonwebtoken`, throws `AuthError`. **Extended** in Phase 5 to dispatch by claim shape.
- `src/errors/AuthError.ts` (or wherever `AuthError` lives) — pattern for new `OAuthError` class.
- `src/utils/error.ts` — `handleHttpError` switch. **Extended** in Phase 3 to recognize `OAuthError`.

### Server / Express

- `src/server.ts` — Express app, mounts `/mcp` and other routes. **Extended** in Phase 3 (mount `/oauth/*`) and Phase 4 (mount `/oauth/authorize` view).
- `src/clients/aem-backend-client.ts` — Axios wrapper pattern. **Reused** in `src/clients/aem-backend-oauth-client.ts` (new) in Phase 4.

### Config

- `src/config/env.ts` — Zod schema + transform pattern. **Extended** in Phase 3 with `MCP_OAUTH_SIGNING_KEY` (`.min(32)`), `OAUTH_*` TTLs.

### Logging

- `src/utils/logger.ts` — Structured logger. **Extended** in Phase 8 with 6 oauth event types.

### Tests

- `tests/e2e/mcp-http.test.ts` — supertest e2e pattern, signs session JWT in-test with dev secret. **Reference** for `tests/e2e/oauth-device-flow.test.ts` and `tests/e2e/oauth-mcp-call.test.ts` (new in Phase 7 / 10).

## Cross-repo (aem-backend)

Branch: `feature/DEV-4154-external-agent-auth` at `/Users/henry/Documents/Github/aem/aem-backend`, commit `edeb6837`.

### Files aem-mcp consumes

- `aem-backend/src/app/controller/OAuthExchangeController.ts` — `POST /api/oauth/exchange` route handler. Defines request/response shape.
- `aem-backend/src/app/controller/request/OAuthExchangeDto.ts` — DTO: `{ email, password, totpCode? }`.
- `aem-backend/src/domain/usecase/OAuthExchangeUseCase.ts` — orchestration. aem-mcp can rely on: uniform `invalidCredentials` 401, separate `twoFactorRequired` 401.
- `aem-backend/src/infrastructure/service/OAuthExchangeTokenService.ts` — JWT claim shape:
  ```typescript
  { sub: <userId-as-string>, aud: 'aem-mcp', jti: <uuid>, iat, exp }
  ```
  HS256, 60s TTL. aem-mcp verifies locally with the same `MCP_OAUTH_SIGNING_KEY`.

### Contract assumption

- `MCP_OAUTH_SIGNING_KEY` env var must have the **same value** in both aem-backend and aem-mcp.
- `aem-mcp`'s verification uses `audience: 'aem-mcp'` (matches the backend's signing).
- `MCP_BACKEND_OAUTH_EXCHANGE_URL` (new aem-mcp env var) points to aem-backend's `POST /api/oauth/exchange`.

## Standards (defined in this spec)

- `standards.md` — `api/response-format`, `api/error-handling`, `auth/session-vs-access-token`.

## External

- RFC 8628 — [OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628). Sections 3.1, 3.4, 3.5, 4.1, 4.2 directly relevant.
- RFC 6749 — [OAuth 2.0 Framework](https://datatracker.ietf.org/doc/html/rfc6749). Section 5.2 error response shape.
- ChatGPT Custom MCP Connectors — [docs.openai.com](https://platform.openai.com/docs/mcp) (to be confirmed in Phase 9).
- Claude Code MCP docs — [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code/mcp) (to be confirmed in Phase 9).
