# Standards for DEV-4154 aem-mcp OAuth

Three standards apply. Each is defined inline here; the file paths listed will be created in a follow-up commit (not part of this spec-only run).

---

## api/response-format

All REST endpoints (existing and new OAuth routes) MUST return responses in the same envelope shape:

```typescript
type ResponseEnvelope<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: { code: string; message: string; details?: unknown } };
```

Helpers live in `src/utils/response.ts` (existing). New OAuth routes MUST use `sendSuccess(res, data, message?)` and `sendError(res, code, message, status, details?)` from that module.

### Applies to

- `src/oauth/routes.ts` (`POST /oauth/device`, `POST /oauth/token`)
- `src/oauth/connected-agents-routes.ts` (`GET /api/agents`, `DELETE /api/agents/:jti`)
- `src/oauth/login-exchange-handler.ts` form POST response (uses redirect + flash, not envelope — exception noted)

### Exception

`GET /oauth/authorize` and `POST /oauth/authorize` are HTML form routes, not JSON. They return HTML (rendered via `views/device-authorization-page.ts`). Documented exception, not a violation.

---

## api/error-handling

All errors thrown from OAuth route handlers MUST be one of:

1. `OAuthError` (new, defined in `src/oauth/errors.ts`) — extends `Error`, has `code: string`, `httpStatus: number`, optional `details`.
2. `RestError` (existing) — for backend-call failures forwarded as-is.
3. `AuthError` (existing) — for token verify failures.

`src/utils/error.ts::handleHttpError` (existing) MUST be extended to recognize `OAuthError` and emit its `httpStatus` + `code`. The new branch is added in Phase 3.

### Standard `OAuthError` codes

| Code | HTTP | When |
|------|------|------|
| `invalid_request` | 400 | Missing or malformed body |
| `invalid_client` | 401 | Bad `client_id` (future; not in v1) |
| `invalid_grant` | 400 | `device_code` not found / not in `approved` status |
| `unauthorized_client` | 400 | `client_id` not allowed for this scope (future; not in v1) |
| `unsupported_grant_type` | 400 | `grant_type` is not `device_code` |
| `invalid_scope` | 400 | Scope not in allowlist |
| `authorization_pending` | 400 | RFC 8628 §3.5: user has not approved yet |
| `slow_down` | 400 | RFC 8628 §3.5: polling too fast |
| `expired_token` | 400 | RFC 8628 §3.5: device_code expired |
| `access_denied` | 400 | RFC 8628 §3.5: user denied |
| `server_error` | 500 | Internal error |
| `temporarily_unavailable` | 503 | RFC 8628 §3.5: `OAUTH_ENABLED=false` short-circuit |

### Applies to

- All new files in `src/oauth/`
- `src/utils/error.ts` (extension)
- `src/auth/verify-session-token.ts` (returns `AuthError`, not `OAuthError`)

---

## auth/session-vs-access-token

`src/auth/verify-session-token.ts` dispatches by claim shape, not by header or token type field.

### Dispatch rule

```typescript
function verify(token: string): AuthContext {
  const decoded = jwt.verify(token, env.MCP_OAUTH_SIGNING_KEY, {
    algorithms: ['HS256'],
  }) as Record<string, unknown>;

  // MCP access token (new)
  if (typeof decoded.sub === 'string' && decoded.aud === 'aem-mcp' && typeof decoded.jti === 'string') {
    return verifyMcpAccessToken(decoded);
  }

  // Session token (existing — backward compatible)
  if (typeof decoded.id === 'number') {
    return verifySessionToken(decoded);
  }

  throw new AuthError('Token has unrecognized claim shape', 401);
}
```

### MCP access token claims (Phase 5 / D2)

```typescript
interface McpAccessTokenClaims {
  sub: string;            // user id as string (RFC 7519 §4.1.2)
  aud: 'aem-mcp';
  jti: string;            // UUID; checked against revocation map
  iat: number;
  exp: number;            // iat + 3600 (D5)
  scope: 'aem-mcp:read';  // D4
}
```

### Session token claims (existing, unchanged)

```typescript
interface SessionTokenClaims {
  id: number;             // user id as number
  iat: number;
  exp: number;
}
```

### Applies to

- `src/auth/verify-session-token.ts` (extended)
- `src/auth/revocation-check.ts` (new)
- `src/oauth/issuer.ts` (mints MCP access token per spec above)
