import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';

import { AuthError, extractSessionToken, verifySessionToken } from './auth/verify-session-token';
import { createAemBackendClient } from './clients/aem-backend-client';
import { createAemBackendOAuthClient } from './clients/aem-backend-oauth-client';
import type { Env } from './config/env';
import { createDeviceCodesStore } from './oauth/device-codes';
import { BackendError } from './errors/backend-error';
import { ToolPolicyError } from './errors/tool-policy-error';
import { AccessTokenError, verifyAccessToken } from './oauth/access-token-verify';
import { createConnectedAgentsRouter } from './oauth/connected-agents-routes';
import { createIssuer } from './oauth/issuer';
import { createLoginExchangeRouter } from './oauth/login-exchange-handler';
import { createPairingsStore } from './oauth/pairings';
import { createRateLimiter } from './oauth/rate-limit';
import { createRevocationStore } from './oauth/revocation';
import { createOAuthRouter } from './oauth/routes';
import { createToolRegistry } from './tools/registry';
import { registerReadTools } from './tools/register-tools';
import { audit } from './utils/audit';
import { logError } from './utils/logger';

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function handleHttpError(res: Response, error: unknown): void {
  if (error instanceof AuthError) {
    sendError(res, 401, error.message);
    return;
  }
  if (error instanceof AccessTokenError) {
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

  // OAuth wiring (Phase 3). All stores are in-process + filesystem-free for
  // the foundation slice; Phase 4 will add the login-exchange handler that
  // writes the filesystem backup. Rate limiter is in-process; multi-pod is
  // out of scope per the spec.
  const issuer = createIssuer({
    signingKey: env.MCP_OAUTH_SIGNING_KEY,
    accessTokenTtlSeconds: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  });
  const deviceCodes = createDeviceCodesStore({ verificationUri: env.OAUTH_VERIFICATION_URI });
  const pairings = createPairingsStore();
  const revocation = createRevocationStore();
  const rateLimiter = createRateLimiter({
    budgets: {
      oauth_device: env.RATE_LIMIT_OAUTH_DEVICE_PER_MIN,
      oauth_token: env.RATE_LIMIT_OAUTH_TOKEN_PER_MIN,
    },
  });
  const oauthRouter = createOAuthRouter({
    issuer,
    deviceCodes,
    pairings,
    revocation,
    rateLimiter,
    oauthEnabled: env.OAUTH_ENABLED,
    verificationUri: env.OAUTH_VERIFICATION_URI,
    deviceCodeTtlSeconds: env.OAUTH_DEVICE_CODE_TTL_SECONDS,
    devicePollIntervalSeconds: env.OAUTH_DEVICE_POLL_INTERVAL_SECONDS,
  });
  app.use(oauthRouter);
  app.use(
    createLoginExchangeRouter({
      aemBackendOAuth: createAemBackendOAuthClient(env),
      deviceCodes,
      env,
      oauthEnabled: env.OAUTH_ENABLED,
    }),
  );
  app.use(
    createConnectedAgentsRouter({ env, pairings, revocation }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'aem-mcp' });
  });

  app.get('/ready', (_req, res) => {
    res.json({ status: 'ready', service: 'aem-mcp' });
  });

  app.post('/mcp', express.json(), async (req: Request, res: Response) => {
    try {
      const authorization = req.header('authorization');
      const isBearer = typeof authorization === 'string' && authorization.startsWith('Bearer ');

      let session;
      let authToken: string;
      if (isBearer) {
        // Phase 5: MCP access token path. Verify with MCP_OAUTH_SIGNING_KEY,
        // check the jti against the revocation map, and resolve to a session
        // (numeric userId, email best-effort from pairings).
        const token = authorization!.slice('Bearer '.length).trim();
        let claims;
        try {
          claims = verifyAccessToken(token, env);
        } catch (err) {
          audit.tokenRejected({ reason: (err as Error).message });
          throw err;
        }
        if (revocation.isRevoked(claims.jti)) {
          audit.tokenRejected({ jti: claims.jti, reason: 'revoked' });
          throw new AuthError('Access token has been revoked');
        }
        const pairing = pairings.get(claims.jti);
        session = {
          userId: claims.userId,
          email: undefined,
          authority: undefined,
          companyId: undefined,
          // attach scope for downstream tool policy
          scope: claims.scope,
          jti: claims.jti,
          clientId: pairing?.clientId,
          authKind: 'mcp-access-token' as const,
        };
        authToken = token;
      } else {
        // Legacy session-cookie path (unchanged).
        const token = extractSessionToken({
          authorization: undefined,
          cookie: req.header('cookie'),
        });
        session = {
          ...verifySessionToken(token, env),
          authKind: 'session' as const,
        };
        authToken = token;
      }

      const server = new McpServer({
        name: 'aem-mcp',
        version: '0.1.0',
      });

      registerReadTools(server, tools, () => ({ session: session as never, token: authToken }));

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
