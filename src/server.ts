import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { extractBearerToken, verifySessionToken } from './auth/verify-session-token';
import { createAemBackendClient } from './clients/aem-backend-client';
import type { Env } from './config/env';
import { createToolRegistry } from './tools/registry';

export function createMcpApp(env: Env): express.Express {
  const app = express();
  const backend = createAemBackendClient(env);
  const tools = createToolRegistry(backend);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'aem-mcp' });
  });

  app.post('/mcp', express.json(), async (req, res) => {
    try {
      const token = extractBearerToken(req.header('authorization'));
      const session = verifySessionToken(token, env);

      const server = new McpServer({
        name: 'aem-mcp',
        version: '0.1.0',
      });

      for (const tool of tools) {
        server.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
          const result = await tool.handler({ session, token }, args as Record<string, unknown>);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        });
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(401).json({ error: message });
    }
  });

  return app;
}

export function startServer(env: Env): void {
  const app = createMcpApp(env);
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`aem-mcp listening on port ${env.PORT}`);
  });
}
