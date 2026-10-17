# 2026-10-10-1500-auth0-login-and-mcp-proxy — External MCP Server Proxy

## Identity

- **Spec version:** `2026-10-10-1500-auth0-login-and-mcp-proxy`
- **Task tier:** **Standard** (1 reviewer)
- **Owner:** Henry
- **This repo:** `aem-mcp` — env-driven external MCP server proxy

## Outcome

An operator can configure external MCP servers (e.g. Figma) via the `MCP_EXTERNAL_SERVERS` env var. After deploying, a single `POST /mcp` endpoint exposes both the existing aem-mcp read tools and the proxied tools from external servers. Agents connecting via OAuth (existing flow) automatically get the merged tool list.

## Context

- No dynamic MCP server registry existed; all tools were statically registered at startup from `READ_TOOLS`.
- This PR adds env-driven external server loading. The operator sets `MCP_EXTERNAL_SERVERS` and redeploys.
- Auth remains unchanged — the existing RFC 8628 OAuth flow continues to work.

## Inputs and Outputs

### `MCP_EXTERNAL_SERVERS` env var

```env
MCP_EXTERNAL_SERVERS=[{"name":"figma","type":"http","url":"https://mcp.figma.com/mcp","authHeader":"Bearer XYZ"}]
```

- `name`: unique identifier, used in logging only
- `type`: only `"http"` supported in this PR
- `url`: base URL of the external MCP server
- `authHeader` (optional): static `Authorization` header to send with every request

### Tool proxy behavior

- On startup, for each external server: connect via `StreamableHTTPClientTransport`, call `tools/list`, then register each tool on the same `McpServer` instance with a handler that forwards to the external server.
- All tools (local + proxied) are served via the existing single `POST /mcp` endpoint.
- Startup log: `[mcp] mounted N external tools from: figma, github, ...`

## In Scope

- `src/config/env.ts` — add `MCP_EXTERNAL_SERVERS` optional string env var
- `src/external/types.ts` — `ExternalServerConfig` type
- `src/external/client.ts` — `createExternalServerClient(config)` using `StreamableHTTPClientTransport` + `Client`
- `src/external/registry.ts` — `loadExternalServersFromEnv(env)` — parse + validate
- `src/external/mount.ts` — `mountExternalTools(mcpServer, clients)` — register proxied tools
- `src/server.ts` — call `mountExternalTools` after local registry build
- `.env.example` — document `MCP_EXTERNAL_SERVERS` with Figma example
- `tests/unit/external/` — unit tests for registry and mount

## Out of Scope

- Auth0 login (handled in aem-backend companion spec)
- Runtime UI for adding/removing servers (env-only per decision)
- Per-server OAuth / API key management beyond static `authHeader`
- Multi-pod persistence of external server configs

## Constraints

- External server tools are **read-only proxies** — no write tool policy exemption needed (tools come from the external server).
- If an external server is unreachable at startup, log a warning and skip it; do not fail boot.
- External server tools use the same auth as the calling agent (OAuth Bearer token validated before tool dispatch).
- Keep the `McpServer` instance creation inside the `POST /mcp` handler (no pre-warmed server per external server).

## Test Assertions

- Given `MCP_EXTERNAL_SERVERS=[{"name":"figma","type":"http","url":"https://example.com/mcp"}]`, when the server boots, then it logs "mounted N external tools from: figma".
- Given a malformed `MCP_EXTERNAL_SERVERS` value, when the server boots, then it throws a clear env validation error.
- Given a valid config with duplicate names, when the server boots, then it throws on duplicate names.
- Given a mock MCP client returning one tool, when `mountExternalTools` is called, then `mcpServer.tool()` is called once with that tool's name/description/schema.

## Required Verification

| Suite | Command |
|---|---|
| Lint | `npm run lint` |
| Unit tests | `npm run test:unit` |
| Coverage | 100% on `src/external/` files |

## Rollback

Revert the merge commit. Remove env var. No persistence to clean.

## Definition of Done

- [ ] All test assertions pass.
- [ ] `npm run lint` exits 0.
- [ ] Unit tests at 100% coverage on `src/external/` files.
- [ ] `npm run build` exits 0.
- [ ] PR opened against `feature/DEV-XXXX-external-mcp-proxy` off `main`.
