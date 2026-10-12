# Standards Applied

- Env schema via `zod` (existing pattern in `src/config/env.ts`)
- `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js` (existing MCP transport pattern)
- Structured logging via `src/utils/logger`
- Express router wiring pattern

## Key patterns followed

- `src/config/env.ts` as reference for Zod schema + transform
- `src/tools/registry.ts` as reference for `ToolDefinition` shape
- `src/auth/verify-session-token.ts` as reference for module structure
- Existing `@modelcontextprotocol/sdk` usage in `src/server.ts` as reference for transport patterns
