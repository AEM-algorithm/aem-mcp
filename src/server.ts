import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';

import { AuthError, extractSessionToken, verifySessionToken } from './auth/verify-session-token';
import type { SessionContext } from './auth/session-context';
import { createAemBackendClient } from './clients/aem-backend-client';
import { createAemBackendOAuthClient } from './clients/aem-backend-oauth-client';
import type { Env } from './config/env';
import { createAuthCodesStore } from './oauth/auth-codes';
import { createDeviceCodesStore } from './oauth/device-codes';
import { BackendError } from './errors/backend-error';
import { ToolPolicyError } from './errors/tool-policy-error';
import { AccessTokenError, verifyAccessToken } from './oauth/access-token-verify';
import { getSessionToken } from './oauth/session-bridge';
import { createConnectedAgentsRouter } from './oauth/connected-agents-routes';
import { createIssuer } from './oauth/issuer';
import { createLoginExchangeRouter } from './oauth/login-exchange-handler';
import { createPairingsStore } from './oauth/pairings';
import { createRateLimiter } from './oauth/rate-limit';
import { createRevocationStore } from './oauth/revocation';
import { createOAuthRouter } from './oauth/routes';
import { DEFAULT_SCOPE } from './oauth/scopes';
import { createToolRegistry } from './tools/registry';
import { registerReadTools } from './tools/register-tools';
import { audit } from './utils/audit';
import { logError, logInfo } from './utils/logger';
import { createAllExternalServerClients } from './external/client';
import { loadExternalServersFromEnv } from './external/registry';
import { mountExternalTools } from './external/mount';
import type { ExternalServerClient } from './external/types';

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

  // OAuth 2.0 Authorization Server Metadata (RFC 8414) used by remote MCP
  // clients to discover the authorization and token endpoints.
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    const baseUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT}`;
    res.status(200).json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      device_authorization_endpoint: `${baseUrl}/oauth/device`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      grant_types_supported: [
        'authorization_code',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      response_types_supported: ['code'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [DEFAULT_SCOPE],
      code_challenge_methods_supported: ['plain', 'S256'],
    });
  });
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
  // Authorization-code grants cross the browser authorization handler and
  // the token endpoint, so both routers must use this same app-scoped store.
  const authCodes = createAuthCodesStore();
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
    authCodes,
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
      authCodes,
      env,
      oauthEnabled: env.OAUTH_ENABLED,
    }),
  );
  app.use(
    createConnectedAgentsRouter({ env, pairings, revocation }),
  );

  // Load external MCP clients once at startup. Unreachable upstreams are
  // skipped by the client factory; local tools remain available.
  const externalConfigs = loadExternalServersFromEnv(env);
  const cachedExternalClients: ExternalServerClient[] = [];
  if (externalConfigs.length > 0) {
    void createAllExternalServerClients(externalConfigs)
      .then((clients) => {
        cachedExternalClients.push(...clients);
        logInfo('external_servers_ready', {
          requested: String(externalConfigs.length),
          connected: String(clients.length),
          names: clients.map((client) => client.config.name).join(','),
        });
      })
      .catch((error: unknown) => {
        logError('external_servers_load_failed', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      });
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'aem-mcp' });
  });

  app.get('/ready', (_req, res) => {
    res.json({ status: 'ready', service: 'aem-mcp' });
  });

  async function handleMcpRequest(req: Request, res: Response): Promise<void> {
    try {
      const authorization = req.header('authorization');
      const isBearer = typeof authorization === 'string' && authorization.startsWith('Bearer ');

      let session: SessionContext;
      let getToolContext: () => Promise<{ session: SessionContext; token: string }>;
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
        // Do not make the MCP initialize handshake depend on the backend
        // session bridge. Cursor completes OAuth only after initialize
        // succeeds. Resolve the Journaler session lazily when a tool is run.
        getToolContext = async () => ({
          session,
          token: await getSessionToken(token, env),
        });
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
        getToolContext = async () => ({ session, token });
      }

      const server = new McpServer({
        name: 'aem-mcp',
        version: '0.1.0',
        icons: [
          {
            src: 'https://media.licdn.com/dms/image/v2/D560BAQEN6iBYItMw-Q/company-logo_200_200/B56ZelY3yyGQAM-/0/1750826450741/aem_algorithm_logo?e=2147483647&v=beta&t=ZGwTk-7b-L8qE_TjJeH_m448ke0Dp_934gmiYYvZhA0',
            mimeType: 'image/jpeg',
          },
        ],
      });

      registerReadTools(server, tools, getToolContext);

      const localToolNames = new Set(tools.map((tool) => tool.name));
      mountExternalTools(server, cachedExternalClients, localToolNames);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      handleHttpError(res, error);
    }
  }

  // Streamable HTTP uses POST for JSON-RPC messages and GET to open the
  // server-to-client SSE stream. Keep both methods on the same auth and
  // transport path so clients that establish SSE first do not get Express 404.
  app.get('/mcp', handleMcpRequest);
  app.post('/mcp', express.json(), handleMcpRequest);

  return app;
}

export function startServer(env: Env): void {
  const app = createMcpApp(env);
  // Bind 0.0.0.0 so the container is reachable on EC2 / Docker networks
  app.listen(env.PORT, '0.0.0.0', () => {
     
    console.log(`aem-mcp listening on 0.0.0.0:${env.PORT}`);
  });
}
