# External Agent Connectors

This guide describes how external MCP clients authenticate to the AEM
Journaler MCP server (`aem-mcp`). The server implements OAuth device flow
and authorization-code flow with PKCE. OpenAI clients such as ChatGPT and Codex use MCP OAuth discovery and
authorization-code flow with PKCE. The implementation publishes the
required protected-resource and authorization-server metadata and binds
the authorization response and token to the resource URL.

## Authentication flow

1. A compatible client discovers the OAuth endpoints from the server
   metadata. Clients that use device authorization start by calling
   `POST /oauth/device`.
2. For device authorization, the server returns a `device_code` and a short,
   human-readable `user_code` (e.g. `ABCD-EFGH`) plus a `verification_uri`.
3. The user opens `verification_uri` in a browser, types the `user_code`,
   and signs in through the AEM frontend. The browser returns to aem-mcp's
   signed device-binding callback and shows “Device paired”. Operators can
   select the inline form with `?bridge=0` for local troubleshooting.
4. For device flow, the agent polls `POST /oauth/token` with the `device_code`. The
   endpoint returns `authorization_pending` until the user approves, then
   a Bearer access token (`access_token`).
5. The agent uses `Authorization: Bearer <access_token>` on every call
   to `/mcp`.

For device flow, tokens expire after 1 hour. There are no refresh
tokens; the agent must re-pair when the token expires or is revoked.

The server also supports authorization-code flow with PKCE for clients
that use a browser redirect. The MCP access token represents the user's
Journaler account. It is separate from the user's sign-in to ChatGPT,
Codex, Claude, or another AI product.

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
| Gemini CLI | `<base>` | See below |

---

### Claude Code

Add the remote HTTP server through Claude Code's MCP command:

```bash
claude mcp add --transport http aem-journaler https://mcp.aem-algorithm.com/mcp
```

Then run `/mcp` in Claude Code and follow its browser OAuth prompt.
Claude Code manages the remote-server OAuth credentials. See the
[Anthropic MCP guide](https://docs.anthropic.com/en/docs/claude-code/mcp).

---

### ChatGPT

In ChatGPT, create a custom MCP connector and enter the public MCP URL:
`https://mcp.aem-algorithm.com/mcp`. Use the product's OAuth sign-in
when prompted; do not enter a device endpoint or a hard-coded client ID.
ChatGPT uses authorization-code with PKCE and OAuth discovery. If ChatGPT
reports **"auth unsupported"**, confirm that the deployed server includes
the compatibility updates below and that `PUBLIC_URL` matches its public
HTTPS origin.

---

### Codex

Add the remote MCP server in Codex's MCP settings (or the MCP server
configuration supported by your installed Codex client), using:

```text
https://mcp.aem-algorithm.com/mcp
```

Complete the OAuth browser flow when prompted. Current Codex clients use
OAuth discovery and authorization-code with PKCE; the old device-flow
TOML keys in this guide are not a supported current setup. If authentication
is rejected as unsupported, confirm the server is updated and `PUBLIC_URL`
points to the public HTTPS origin.

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

### Gemini CLI & Antigravity (Extension / Plugin)

`aem-mcp` is packaged directly as a Gemini extension and Antigravity plugin.

#### Option A: One-click Extension Install (Gemini CLI)
Install directly from the GitHub repository:
```bash
gemini extensions install https://github.com/aem-algorithm/aem-mcp
```
Or for local development:
```bash
gemini extensions link /path/to/aem-mcp
```

#### Option B: Manual settings (`~/.gemini/settings.json`)
You can also manually register the remote MCP server:
```json
{
  "mcpServers": {
    "aem-journaler": {
      "url": "https://mcp.aem-algorithm.com/mcp",
      "type": "http"
    }
  }
}
```

Then run Gemini CLI and authenticate when prompted (or use `/mcp auth aem-journaler`). Gemini CLI uses authorization-code + PKCE with a local loopback callback. Complete Journaler login in the browser; the callback returns to Gemini CLI. This requires a local browser and the CLI running on the same machine as its callback listener.

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

## OpenAI compatibility status

AEM-MCP publishes:

- `/.well-known/oauth-protected-resource`, with the canonical resource URL
  and authorization-server issuer.
- `/.well-known/oauth-authorization-server`, advertising authorization
  code, public-client token exchange, and PKCE `S256`.
- `iss` on successful and error authorization redirects.

The authorization request's `resource` is carried into the one-time
authorization code, checked again at the token endpoint, and included as
the `resource` claim in the issued access token. Both the public origin and
its `/mcp` endpoint URI are accepted as resource identifiers. The legacy
`aud: "aem-mcp"` claim remains in place for the Journaler backend session bridge.

For a deployed instance, set `PUBLIC_URL` to its exact public HTTPS origin
(without a trailing slash), then restart/redeploy the service. Confirm that
both well-known URLs return JSON before retrying the ChatGPT connection.
The ChatGPT and Claude browser callbacks are restricted to their documented
callback paths; other clients must use loopback redirect URIs.

## Manual device-flow fallback

For a client that supports a manually supplied Bearer token but cannot
perform OAuth discovery, an operator can complete RFC 8628 device flow:

1. Call `POST /oauth/device`.
2. Open the returned `verification_uri` and approve the `user_code`.
3. Poll `POST /oauth/token` with the `device_code` until the server returns
   an `access_token`.
4. Configure the MCP client to send `Authorization: Bearer <access_token>`
   to `/mcp`.
5. Re-pair when the token expires or is revoked.

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
