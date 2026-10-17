# References — Tool-call Session Bridge

## Existing code to study

### aem-backend OAuth exchange client

- **Location:** `src/clients/aem-backend-oauth-client.ts`
- **Relevance:** Exact pattern to mirror — typed errors, env-driven URL, axios with `validateStatus: () => true`, envelope parsing.
- **Key patterns to borrow:**
  - `AemBackendOAuthError` typed error class with `code`, `status`, `message`
  - `BackendError` from `src/errors/backend-error.ts` for 5xx
  - Envelope shape: `envelope.status`, `envelope.data`, `envelope.message`, `envelope.errorCode`
  - Treat 4xx as `AemBackendOAuthError`, 5xx as `BackendError`

### Access token verifier

- **Location:** `src/oauth/access-token-verify.ts`
- **Relevance:** Gives us the `jti` from the MCP access token. We call this inside `getSessionToken` to get the cache key.
- **Key patterns:**
  - `AccessTokenError` for invalid tokens
  - `verifyAccessToken(token, env): { userId, jti, scope, ... }`
  - HS256, audience `aem-mcp`, claims `sub` (string userId), `jti`, `scope`

### Exchange code verifier (companion pattern)

- **Location:** `src/oauth/exchange-code-verify.ts`
- **Relevance:** Same family of "verify a short-lived JWT from aem-backend" code; same `MCP_OAUTH_SIGNING_KEY` is used.
- **Key patterns:**
  - `ExchangeCodeError` typed errors with `code: 'invalid_token' | 'wrong_audience' | 'expired'`
  - Parse `sub` → `userId: number`

### /mcp handler

- **Location:** `src/server.ts:166-225` (Bearer branch)
- **Relevance:** The line that needs to change. Currently `authToken = token` (line 213) forwards the MCP access token to aem-backend. After this change, `authToken` will be the bridged session token.

### Error dispatch

- **Location:** `src/server.ts:35-55` `handleHttpError`
- **Relevance:** New errors thrown by `getSessionToken` flow through here unchanged.

## External references

- aem-backend companion PR — `POST /api/oauth/session` handler (out of scope; documented in `plan.md` Wire Format section).
- [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750) — Bearer Token Usage (the existing `Authorization: Bearer` header on `/mcp` is RFC 6750 compliant).
- aem-backend session token shape: HS256, `id: number`, `type: 'session'`, `currentAuthority`, `need2FA`, `expiresIn: 900` (15 min).
