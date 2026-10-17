# Standards — MCP Session Reuse (All Providers)

**Date:** 2026-10-15-2200  
**Slug:** mcp-session-reuse-all-providers

## Pre-existing Standards Applied

| Topic ID | Title | Applied To |
|---|---|---|
| `auth/session-vs-access-token` | Session vs Access Token | aem-backend session validation logic |
| `api/response-format` | Standard API Response Format | New `/api/oauth/exchange-by-session` endpoint |

## New Standard Introduced

### `auth/cookie-forwarding`

**Scope:** aem-mcp must forward the `Cookie: token=...` header verbatim to aem-backend's `/api/oauth/exchange-by-session` when performing session reuse.

**Rules:**
- Forward the header exactly as received; do not parse, re-encode, or modify the value.
- The header must never be logged, written to disk, or included in error messages.
- If the header is absent, fall through to the normal device-authorization flow (no error).
- aem-backend validates the session and returns tokens or 401.
