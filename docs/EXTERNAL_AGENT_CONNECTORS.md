# External Agent Connectors

This guide shows how to connect a Model Context Protocol (MCP) client to
the AEM Journaler MCP server (`aem-mcp`) using the **OAuth 2.0 Device
Authorization Grant** ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)).
It is the only supported authentication flow for external agents in v1.

If your MCP client does **not** support RFC 8628 natively, see the
[Workarounds](#workarounds-for-non-compliant-clients) section.

## Quick start

1. The agent starts the flow by calling `POST /oauth/device`.
2. The server returns a `device_code` and a short, human-readable
   `user_code` (e.g. `ABCD-EFGH`) plus a `verification_uri`.
3. The user opens `verification_uri` in a browser, types the `user_code`,
   and signs in with their AEM account.
4. The agent polls `POST /oauth/token` with the `device_code`. The
   endpoint returns `authorization_pending` until the user approves, then
   a Bearer access token (`access_token`).
5. The agent uses `Authorization: Bearer <access_token>` on every call
   to `/mcp`.

Tokens expire after 1 hour. There are **no refresh tokens**; the agent
must re-pair via `/oauth/device` when the token expires or is revoked.

## Connector configuration

The MCP endpoints all live under a single base URL. The default for
local development is `http://localhost:3000`; production uses the URL
your operator assigned (e.g. `https://mcp.aem-algorithm.com`).

| Connector | Base URL | Notes |
|-----------|----------|-------|
| Claude Code | `<base>` | See below |
| ChatGPT | `<base>` | See below |
| Codex (CLI) | `<base>` | See below |
| Cursor | `<base>` | See below |

---

### Claude Code

Add an MCP server entry to `~/.claude.json` (or the project's
`.mcp.json`):

```json
{
  "mcpServers": {
    "aem-journaler": {
      "type": "http",
      "url": "https://mcp.aem-algorithm.com/mcp",
      "oauth": {
        "grantType": "device_code",
        "deviceEndpoint": "https://mcp.aem-algorithm.com/oauth/device",
        "tokenEndpoint": "https://mcp.aem-algorithm.com/oauth/token",
        "clientId": "claude-code"
      }
    }
  }
}
```

When Claude Code starts, it will:

1. Call `/oauth/device` and present the `user_code` in the terminal.
2. Print the `verification_uri` for the user to open.
3. Poll `/oauth/token` until approved, then use the Bearer token on
   `/mcp`.

If your Claude Code build predates native RFC 8628 support, fall back to
the [Workarounds](#workarounds-for-non-compliant-clients) section.

---

### ChatGPT (Custom MCP connector)

ChatGPT's custom MCP connector (Settings → Connectors → Custom) supports
RFC 8628 directly.

1. Open **Settings → Connectors → Create**.
2. Set **Connector name** to `AEM Journaler`.
3. Set **MCP server URL** to `https://mcp.aem-algorithm.com/mcp`.
4. Set **Authentication** to `OAuth 2.0`.
5. Set **Device authorization endpoint** to
   `https://mcp.aem-algorithm.com/oauth/device`.
6. Set **Token endpoint** to
   `https://mcp.aem-algorithm.com/oauth/token`.
7. Set **Client ID** to `claude-code` (the v1 default; will become
   per-product in v2).

ChatGPT will display the user_code and verification_uri during sign-in.

---

### Codex (CLI)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.aem-journaler]
url = "https://mcp.aem-algorithm.com/mcp"
oauth_grant_type = "device_code"
oauth_device_endpoint = "https://mcp.aem-algorithm.com/oauth/device"
oauth_token_endpoint = "https://mcp.aem-algorithm.com/oauth/token"
oauth_client_id = "codex"
```

Codex will print the `user_code` in the terminal on first use and poll
the token endpoint until you approve in the browser.

---

### Cursor

Cursor's MCP client supports custom servers with OAuth.

1. Open **Settings → Models → Custom OpenAI API key** (this is unrelated
   to MCP; just for the underlying model).
2. Open **Settings → MCP → Add new global MCP server**.
3. Paste:

```json
{
  "mcpServers": {
    "aem-journaler": {
      "url": "https://mcp.aem-algorithm.com/mcp",
      "auth": {
        "type": "oauth",
        "grant_type": "device_code",
        "device_endpoint": "https://mcp.aem-algorithm.com/oauth/device",
        "token_endpoint": "https://mcp.aem-algorithm.com/oauth/token",
        "client_id": "cursor"
      }
    }
  }
}
```

4. Save and restart Cursor. On first invocation Cursor will display the
   user_code and verification_uri.

---

## Managing connected agents

List and revoke your connected agents via the Connected-agents API.

```bash
# List all of your connected agents
curl -H "Cookie: token=$YOUR_SESSION_TOKEN" \
  https://mcp.aem-algorithm.com/api/agents

# Revoke a specific agent by its jti
curl -X DELETE -H "Cookie: token=$YOUR_SESSION_TOKEN" \
  https://mcp.aem-algorithm.com/api/agents/<jti>
```

If your agent is using a Bearer MCP access token, replace the cookie
with `Authorization: Bearer $ACCESS_TOKEN`. The two are interchangeable
on `/api/agents`.

Revoking an agent immediately invalidates the access token (any further
calls to `/mcp` with that token return 401).

---

## Workarounds for non-compliant clients

If your MCP client does not support RFC 8628 device flow natively:

1. Manually call `POST /oauth/device` (e.g. with `curl`).
2. Open the returned `verification_uri` and complete the browser sign-in.
3. Poll `POST /oauth/token` with the `device_code` until you get an
   `access_token`.
4. Set `Authorization: Bearer <access_token>` on every call to `/mcp`.
5. When the token expires (or is revoked), repeat from step 1.

For example:

```bash
# 1. Issue a device code
DC=$(curl -s -X POST https://mcp.aem-algorithm.com/oauth/device \
  -H "content-type: application/json" \
  -d '{"client_id":"my-script"}')
echo "$DC"
# {"device_code":"...","user_code":"ABCD-EFGH","verification_uri":"https://app.aem-algorithm.com/agent-link",...}

# 2. Open the verification_uri in your browser and sign in.
# 3. Poll for the token (2s interval per spec).
DEVICE_CODE=$(echo "$DC" | jq -r .device_code)
until TOKEN=$(curl -s -X POST https://mcp.aem-algorithm.com/oauth/token \
  -H "content-type: application/json" \
  -d "{\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\",\"device_code\":\"$DEVICE_CODE\"}" \
  | jq -r .access_token); [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; do
  sleep 2
done

# 4. Use the token.
curl -H "Authorization: Bearer $TOKEN" \
  https://mcp.aem-algorithm.com/mcp
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `429` on `POST /oauth/device` | Rate limit (5/min per IP) | Wait 60s, then retry |
| `authorization_pending` (400) | User has not approved yet | Keep polling; do not retry too fast |
| `expired_token` (400) | 10-minute TTL elapsed | Start a new flow |
| `access_denied` (400) | User clicked "Deny" on the form | Start a new flow |
| `401` on `/mcp` | Token is revoked or expired | Re-pair via `/oauth/device` |
| Browser shows "This code has expired" | User took too long; device code TTL = 10 min | Restart the agent |

## See also

- [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) — OAuth 2.0
  Device Authorization Grant
- [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) — OAuth 2.0
  Token Revocation
- The `agent-os/specs/2026-10-08-2353-dev-4154-aem-mcp-external-agent-auth/`
  folder in this repository for the design and shaping notes.
