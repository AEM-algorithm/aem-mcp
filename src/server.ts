import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';

import { AuthError, extractSessionToken, verifySessionToken } from './auth/verify-session-token';
import { createAemBackendClient } from './clients/aem-backend-client';
import type { Env } from './config/env';
import { BackendError } from './errors/backend-error';
import { ToolPolicyError } from './errors/tool-policy-error';
import { createToolRegistry } from './tools/registry';
import { registerReadTools } from './tools/register-tools';
import { logError } from './utils/logger';

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function handleHttpError(res: Response, error: unknown): void {
  if (error instanceof AuthError) {
    sendError(res, 401, error.message);
    return;
  }
  if (error instanceof ToolPolicyError) {
    sendError(res, 400, error.message);
    return;
  }
  if (error instanceof BackendError) {
    const status = error.statusCode >= 500 ? 502 : error.statusCode;
    sendError(res, status, error.message);
    return;
  }

  logError('mcp_request_failed', {
    error: error instanceof Error ? error.message : 'unknown',
  });
  sendError(res, 500, 'Internal server error');
}

export function createMcpApp(env: Env): express.Express {
  const app = express();
  const backend = createAemBackendClient(env);
  const tools = createToolRegistry(backend);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'aem-mcp' });
  });

  app.get('/ready', (_req, res) => {
    res.json({ status: 'ready', service: 'aem-mcp' });
  });

  app.post('/mcp', express.json(), async (req: Request, res: Response) => {
    try {
      const token = extractSessionToken({
        authorization: req.header('authorization'),
        cookie: req.header('cookie'),
      });
      const session = verifySessionToken(token, env);

      const server = new McpServer({
        name: 'aem-mcp',
        version: '0.1.0',
      });

      registerReadTools(server, tools, () => ({ session, token }));

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      handleHttpError(res, error);
    }
  });

  return app;
}

export function startServer(env: Env): void {
  const app = createMcpApp(env);
  // Bind 0.0.0.0 so the container is reachable on EC2 / Docker networks
  app.listen(env.PORT, '0.0.0.0', () => {
     
    console.log(`aem-mcp listening on 0.0.0.0:${env.PORT}`);
  });
}
