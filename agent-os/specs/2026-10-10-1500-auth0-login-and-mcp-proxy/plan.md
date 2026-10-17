# Plan — External MCP Server Proxy

## Ticket

- Spec: `agent-os/specs/2026-10-10-1500-auth0-login-and-mcp-proxy/`
- Branch: `feature/DEV-XXXX-external-mcp-proxy` (off `main`)
- Tier: Standard (1 reviewer)
- This repo: **aem-mcp only**

## File changes

### New files

| File | Purpose |
|---|---|
| `src/external/types.ts` | `ExternalServerConfig` interface: `name`, `type: 'http'`, `url`, `authHeader?: string` |
| `src/external/client.ts` | `createExternalServerClient(config: ExternalServerConfig): Promise<ExternalServerClient>` using `StreamableHTTPClientTransport` + `Client` from `@modelcontextprotocol/sdk` |
| `src/external/registry.ts` | `loadExternalServersFromEnv(env: Env): ExternalServerConfig[]` — parse JSON, validate fields, detect duplicates |
| `src/external/mount.ts` | `mountExternalTools(server: McpServer, clients: Map<string, ExternalServerClient>): void` — call `server.tool()` for each external tool, proxy handler calls `client.callTool()` |
| `tests/unit/external/registry.test.ts` | Happy path, malformed JSON, duplicate names, invalid URL, unknown type |
| `tests/unit/external/mount.test.ts` | Mock MCP client; assert `server.tool()` called per tool, handler forwards correctly |

### Modified files

| File | Change |
|---|---|
| `src/config/env.ts` | Add `MCP_EXTERNAL_SERVERS: z.string().optional()` |
| `src/server.ts` | After `registerReadTools(server, tools, ...)`, call `loadExternalServersFromEnv(env)` then `mountExternalTools(server, clients)` |
| `.env.example` | Add `MCP_EXTERNAL_SERVERS=[{"name":"figma","type":"http","url":"https://mcp.figma.com/mcp"}]` example |

## Sequence

1. Add `MCP_EXTERNAL_SERVERS` to `env.ts` Zod schema.
2. Write `types.ts` and `registry.ts`.
3. Write `client.ts` — use existing `@modelcontextprotocol/sdk` deps.
4. Write `mount.ts`.
5. Update `server.ts` to call the new module.
6. Update `.env.example`.
7. Write unit tests at 100% coverage.
8. Verify: `npm run lint && npm run test:unit && npm run build`.

## Run / Verify

```bash
npm run lint
npm run test:unit
npm run build
```

## Risk

| Risk | Mitigation |
|---|---|
| External server unreachable at startup | Log warning, skip, continue boot |
| Malformed env JSON | Validate in `registry.ts`, throw clear error |
| Duplicate server names | Detect and throw on duplicate |
| Tool name collision with local tools | Log warning and skip external tool with same name |
