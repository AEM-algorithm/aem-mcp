// Full-flow integration tests for the OAuth surface.
//
// The tests stub aem-backend's `POST /api/oauth/exchange` with a
// real local HTTP server so the entire wire path is exercised:
//   1. agent: POST /oauth/device  -> device_code + user_code
//   2. user:  GET  /oauth/authorize?user_code=...  (form)
//   3. user:  POST /oauth/authorize  (form submit) -> 200 success
//   4. agent: POST /oauth/token  -> access_token (jti)
//   5. agent: GET  /api/agents  -> 200 (Bearer path)
//   6. user:  DELETE /api/agents/:jti  -> 200
//   7. agent: GET  /api/agents  -> 401 (revoked jti)
//
// aem-mcp is mounted on supertest's ephemeral port; the stub backend
// runs on a second ephemeral port. The two are wired by env config.

import http from 'node:http';

import bodyParser from 'body-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { loadEnv } from '../../src/config/env';
import type { Env } from '../../src/config/env';
import { createMcpApp } from '../../src/server';

const MCP_OAUTH_SIGNING_KEY = 'a'.repeat(32);
const JWT_SECRET = '1234';

let backendPort = 0;

function startBackendStub(): Promise<{ close: () => Promise<void>; port: number }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(bodyParser.json());
    app.post('/api/oauth/exchange', (req, res) => {
      const { email, password, totpCode } = req.body as {
        email?: string;
        password?: string;
        totpCode?: string;
      };
      // Mirror the aem-backend response envelope so the
      // aemBackendOAuthClient (which reads envelope.data.exchangeCode
      // and envelope.errorCode) decodes the stub correctly.
      if (email === 'twofa@b.co' && !totpCode) {
        res
          .status(401)
          .json({ status: 'error', errorCode: 'twoFactorRequired', message: '2FA code is required' });
        return;
      }
      if (email === 'bad@b.co' || password === 'wrong') {
        res
          .status(401)
          .json({ status: 'error', errorCode: 'invalidCredentials', message: 'Invalid email or password' });
        return;
      }
      const userId = email === 'a@b.co' ? 1 : email === 'c@d.co' ? 2 : 99;
      const exchangeCode = jwt.sign(
        { sub: String(userId), jti: `jti-${userId}-${Date.now()}`, aud: 'aem-mcp' },
        MCP_OAUTH_SIGNING_KEY,
        { algorithm: 'HS256', expiresIn: '60s' },
      );
      res.status(200).json({
        status: 'Success',
        data: { exchangeCode, expiresIn: 60 },
        message: 'Exchange code issued',
      });
    });
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        backendPort = addr.port;
        resolve({
          port: backendPort,
          close: () =>
            new Promise<void>((res2) => {
              server.close(() => res2());
            }),
        });
      }
    });
  });
}

let mcpServer: http.Server | undefined;
let mcpAgent: ReturnType<typeof request>;
let backendHandle: { close: () => Promise<void>; port: number } | undefined;

beforeAll(async () => {
  backendHandle = await startBackendStub();
  const env: Env = loadEnv({
    NODE_ENV: 'test',
    JWT_SECRET,
    MCP_OAUTH_SIGNING_KEY,
    MCP_BACKEND_OAUTH_EXCHANGE_URL: `http://127.0.0.1:${backendHandle.port}/api/oauth/exchange`,
    // raise limits so the e2e tests don't trip the rate limiter
    RATE_LIMIT_OAUTH_DEVICE_PER_MIN: '100000',
    RATE_LIMIT_OAUTH_TOKEN_PER_MIN: '100000',
  });
  const app = createMcpApp(env);
  mcpServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = mcpServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('failed to bind mcp test server');
  }
  mcpAgent = request(`http://127.0.0.1:${addr.port}`);
});

afterAll(async () => {
  if (mcpServer) {
    await new Promise<void>((resolve) => mcpServer!.close(() => resolve()));
  }
  if (backendHandle) {
    await backendHandle.close();
  }
});

describe('integration: full device-flow + connected-agents lifecycle', () => {
  it('agent -> device -> form -> token -> list -> revoke', async () => {
    // 1) issue device code
    const deviceRes = await mcpAgent
      .post('/oauth/device')
      .send({ client_id: 'claude-code', scope: 'aem-mcp:read' });
    expect(deviceRes.status).toBe(200);
    const { device_code, user_code, verification_uri: _v1, expires_in: _e1, interval: _i1 } = deviceRes.body;
    expect(device_code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(typeof _v1).toBe('string');
    expect(_e1).toBeGreaterThan(0);
    expect(_i1).toBeGreaterThan(0);

    // 2) user opens the form
    const getForm = await mcpAgent.get(`/oauth/authorize?user_code=${user_code}&bridge=0`);
    expect(getForm.status).toBe(200);
    expect(getForm.text).toContain(user_code);

    // 3) user submits the form (aem-backend returns exchangeCode -> aem-mcp verifies -> device approved)
    const post = await mcpAgent
      .post('/oauth/authorize')
      .type('form')
      .send({ user_code, email: 'a@b.co', password: 'pw' });
    expect(post.status).toBe(200);
    expect(post.text).toMatch(/Agent connected/);

    // 4) agent exchanges the device_code for an access token
    const tokenRes = await mcpAgent
      .post('/oauth/token')
      .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code });
    if (tokenRes.status !== 200) {
      // eslint-disable-next-line no-console
      console.log('token error:', tokenRes.status, tokenRes.body);
    }
    expect(tokenRes.status).toBe(200);
    const { access_token, token_type, expires_in: _e2, scope } = tokenRes.body;
    expect(token_type).toBe('Bearer');
    expect(_e2).toBeGreaterThan(0);
    expect(scope).toBe('aem-mcp:read');
    expect(typeof access_token).toBe('string');

    // 5) agent lists its own pairings via the Bearer path
    const list = await mcpAgent
      .get('/api/agents')
      .set('authorization', `Bearer ${access_token}`);
    expect(list.status).toBe(200);
    expect(list.body.ok).toBe(true);
    expect(list.body.data.agents.length).toBeGreaterThanOrEqual(1);
    const myPairing = list.body.data.agents.find(
      (a: { userCode: string }) => a.userCode === user_code,
    );
    expect(myPairing).toBeDefined();
    const jti = myPairing.jti as string;

    // 6) revoke the pairing
    const revoke = await mcpAgent
      .delete(`/api/agents/${jti}`)
      .set('authorization', `Bearer ${access_token}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.ok).toBe(true);
    expect(revoke.body.data.revoked).toBe(jti);

    // 7) the same access token is now rejected (revocation check)
    const after = await mcpAgent
      .get('/api/agents')
      .set('authorization', `Bearer ${access_token}`);
    expect(after.status).toBe(401);
  });

  it('rate-limits /oauth/device after threshold (sanity)', async () => {
    // Spec: 5/min. We make 7 in a row; expect at least one 429.
    // Bind a fresh mcp app on a fresh port with the production rate limits.
    const env: Env = loadEnv({
      NODE_ENV: 'test',
      JWT_SECRET,
      MCP_OAUTH_SIGNING_KEY,
      MCP_BACKEND_OAUTH_EXCHANGE_URL: `http://127.0.0.1:${backendHandle!.port}/api/oauth/exchange`,
      RATE_LIMIT_OAUTH_DEVICE_PER_MIN: '5',
      RATE_LIMIT_OAUTH_TOKEN_PER_MIN: '30',
    });
    const localApp = createMcpApp(env);
    const localServer = await new Promise<http.Server>((resolve) => {
      const s = localApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = localServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('failed to bind local server');
    }
    const localAgent = request(`http://127.0.0.1:${addr.port}`);
    const responses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await localAgent
        .post('/oauth/device')
        .send({ client_id: 'claude-code' });
      responses.push(r.status);
    }
    expect(responses).toContain(429);
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
  });

  it('rejects bad credentials with form re-render', async () => {
    // issue + bad form submit
    const dev = await mcpAgent
      .post('/oauth/device')
      .send({ client_id: 'claude-code' });
    const { user_code, device_code } = dev.body;
    const bad = await mcpAgent
      .post('/oauth/authorize')
      .type('form')
      .send({ user_code, email: 'bad@b.co', password: 'wrong' });
    expect(bad.status).toBe(200);
    expect(bad.text).toMatch(/Invalid email or password/);
    // the device_code should still be pending (not approved, not denied)
    const tok = await mcpAgent
      .post('/oauth/token')
      .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe('authorization_pending');
  });

  it('handles 2FA flow (re-render with TOTP field)', async () => {
    const dev = await mcpAgent
      .post('/oauth/device')
      .send({ client_id: 'claude-code' });
    const { user_code, device_code } = dev.body;
    const noTotp = await mcpAgent
      .post('/oauth/authorize')
      .type('form')
      .send({ user_code, email: 'twofa@b.co', password: 'pw' });
    expect(noTotp.status).toBe(200);
    expect(noTotp.text).toMatch(/name="totp"/);

    // second submission with TOTP -> success
    const withTotp = await mcpAgent
      .post('/oauth/authorize')
      .type('form')
      .send({ user_code, email: 'twofa@b.co', password: 'pw', totp: '123456' });
    expect(withTotp.status).toBe(200);
    expect(withTotp.text).toMatch(/Agent connected/);

    const tok = await mcpAgent
      .post('/oauth/token')
      .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code });
    expect(tok.status).toBe(200);
    expect(tok.body.access_token).toBeDefined();
  });
});

describe('integration: device authorization page UI', () => {
  it('renders the email/password form for an issued device code', async () => {
    const dev = await mcpAgent
      .post('/oauth/device')
      .send({ client_id: 'claude-code' });
    const { user_code } = dev.body;
    const get = await mcpAgent.get(`/oauth/authorize?user_code=${user_code}&bridge=0`);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toMatch(/text\/html/);
    // The new form mirrors aem-frontend login.
    // Device flow heading + lead. (auth_code flow uses "Authorize your agent";
    // that case is covered by the auth_code path inside handleGetAuthorize.)
    expect(get.text).toContain('Sign in to connect your agent');
    expect(get.text).toContain('Confirm the code shown by your agent, then sign in with your account.');
    // Email + password inputs (TOTP is NOT shown until 2FA is required).
    expect(get.text).toMatch(/<input id="email"[^>]*name="email"/);
    expect(get.text).toMatch(/<input id="password"[^>]*name="password"/);
    expect(get.text).not.toMatch(/<input id="totp"/);
    // "Remember Me" checkbox (matches aem-frontend copy verbatim).
    expect(get.text).toContain('Remember Me');
    expect(get.text).toMatch(/name="rememberDevice"/);
    // Navy heading + navy primary button (aem-frontend tokens).
    expect(get.text).toMatch(/#0A4777/);
    expect(get.text).toMatch(/--jf-navy:\s*#0A4777/);
    expect(get.text).toMatch(/button\.btn-primary[\s\S]+?background:\s*var\(--jf-navy\)/);
    // "Or sign in with" divider (matches aem-frontend).
    expect(get.text).toContain('Or sign in with');
    // Provider buttons: Auth0 + Google rendered, MetaMask/Xverse disabled.
    expect(get.text).toMatch(/data-provider="auth0"/);
    expect(get.text).toMatch(/data-provider="google"/);
    expect(get.text).toMatch(/data-provider="metamask"[^>]*aria-disabled="true"/);
    expect(get.text).toMatch(/data-provider="xverse"[^>]*aria-disabled="true"/);
    // No Forgot Password / Sign Up when frontendUrl is not set.
    expect(get.text).not.toMatch(/Forgot Password/);
    expect(get.text).not.toMatch(/Sign Up/);
    // Subtitle for the device flow.
    expect(get.text).toContain(user_code);
    // CSP header is preserved.
    expect(get.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
  });

  it('shows the TOTP field and the typed error banner on 2FA prompt', async () => {
    const dev = await mcpAgent
      .post('/oauth/device')
      .send({ client_id: 'claude-code' });
    const { user_code, device_code } = dev.body;
    const noTotp = await mcpAgent
      .post('/oauth/authorize')
      .type('form')
      .send({ user_code, email: 'twofa@b.co', password: 'pw' });
    expect(noTotp.status).toBe(200);
    // TOTP field now visible.
    expect(noTotp.text).toMatch(/<input id="totp"[^>]*name="totp"/);
    // Banner carries the twoFactorRequired kind so tests + a11y can target it.
    expect(noTotp.text).toMatch(/data-error-kind="twoFactorRequired"/);
    // The form should keep the user_code so the second submit completes.
    expect(noTotp.text).toContain(user_code);
    // Finish the flow so we don't leak the device_code into the next test.
    const ok = await mcpAgent
      .post('/oauth/authorize')
      .type('form')
      .send({ user_code, email: 'twofa@b.co', password: 'pw', totp: '123456' });
    expect(ok.status).toBe(200);
    const tok = await mcpAgent
      .post('/oauth/token')
      .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code });
    expect(tok.status).toBe(200);
  });

  it('shows the typed invalidCredentials banner on bad credentials', async () => {
    const dev = await mcpAgent
      .post('/oauth/device')
      .send({ client_id: 'claude-code' });
    const { user_code, device_code } = dev.body;
    const bad = await mcpAgent
      .post('/oauth/authorize')
      .type('form')
      .send({ user_code, email: 'bad@b.co', password: 'wrong' });
    expect(bad.status).toBe(200);
    expect(bad.text).toMatch(/data-error-kind="invalidCredentials"/);
    expect(bad.text).toMatch(/Invalid email or password/);
    // The device_code is still pending so the agent's token poll returns
    // authorization_pending rather than access_denied.
    const tok = await mcpAgent
      .post('/oauth/token')
      .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe('authorization_pending');
  });

  it('renders Forgot Password and Sign Up links when MCP_FRONTEND_URL is configured', async () => {
    // Stand up a second aem-mcp with MCP_FRONTEND_URL set.
    const envWithFrontend: Env = loadEnv({
      NODE_ENV: 'test',
      JWT_SECRET,
      MCP_OAUTH_SIGNING_KEY,
      MCP_BACKEND_OAUTH_EXCHANGE_URL: `http://127.0.0.1:${backendHandle!.port}/api/oauth/exchange`,
      MCP_FRONTEND_URL: 'http://localhost:8000',
      RATE_LIMIT_OAUTH_DEVICE_PER_MIN: '100000',
      RATE_LIMIT_OAUTH_TOKEN_PER_MIN: '100000',
    });
    const app2 = createMcpApp(envWithFrontend);
    const mcpServer2 = await new Promise<http.Server>((resolve) => {
      const s = app2.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = mcpServer2.address();
    if (!addr || typeof addr === 'string') throw new Error('bind failed');
    const agent2 = request(`http://127.0.0.1:${addr.port}`);
    try {
      const dev = await agent2.post('/oauth/device').send({ client_id: 'claude-code' });
      const { user_code } = dev.body;
      const get = await agent2.get(`/oauth/authorize?user_code=${user_code}&bridge=0`);
      expect(get.status).toBe(200);
      expect(get.text).toContain('Forgot Password');
      expect(get.text).toContain('Sign Up');
      expect(get.text).toContain('http://localhost:8000/user/reset-password');
      expect(get.text).toContain('http://localhost:8000/user/register');
    } finally {
      await new Promise<void>((resolve) => mcpServer2.close(() => resolve()));
    }
  });
});

describe('integration: redirect-to-frontend bridge (Phase 6)', () => {
  // Phase 6: when MCP_FRONTEND_URL is configured, aem-mcp can sign an
  // mcp_state JWT and 302 the user to the Journaler web app for
  // authentication. The frontend posts the JWT back to
  // aem-backend's /api/oauth/exchange/agent; backend verifies the
  // signature and binds the device_code.
  //
  // These tests assert the MCP-side contract: the route exists, the
  // redirect is 302, the URL targets aem-frontend, and mcp_state is
  // a valid HS256 JWT signed with MCP_JWT_SECRET.
  // Helper: stand up a dedicated mcp with both MCP_FRONTEND_URL and a
  // distinct MCP_JWT_SECRET so we can verify the JWT signing/verification
  // contract end-to-end. Returns the agent and a close() fn.
  async function startBridgeMcp(): Promise<{
    agent: ReturnType<typeof request>;
    secret: string;
    close: () => Promise<void>;
  }> {
    const secret = 'phase-6-redirect-to-frontend-test-secret-min-32';
    const envBridge: Env = loadEnv({
      NODE_ENV: 'test',
      JWT_SECRET,
      MCP_OAUTH_SIGNING_KEY,
      MCP_BACKEND_OAUTH_EXCHANGE_URL: `http://127.0.0.1:${backendHandle!.port}/api/oauth/exchange`,
      MCP_FRONTEND_URL: 'http://localhost:8000',
      MCP_JWT_SECRET: secret,
      RATE_LIMIT_OAUTH_DEVICE_PER_MIN: '100000',
      RATE_LIMIT_OAUTH_TOKEN_PER_MIN: '100000',
    });
    const app = createMcpApp(envBridge);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const a = server.address();
    if (!a || typeof a === 'string') throw new Error('bind failed');
    return {
      agent: request(`http://127.0.0.1:${a.port}`),
      secret,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    };
  }

  it('redirects to aem-frontend with mcp_state and a signed MCP callback URI', async () => {
    const { agent, secret, close } = await startBridgeMcp();
    try {
      const dev = await agent.post('/oauth/device').send({ client_id: 'claude-code' });
      const { user_code } = dev.body;
      const r = await agent.get(
        `/oauth/authorize/redirect-to-frontend?user_code=${user_code}&redirect_uri=http%3A%2F%2F127.0.0.1%3A8123%2Fcb&state=alpha`,
      );
      expect(r.status).toBe(302);
      const location = r.headers['location'] as string;
      expect(location).toMatch(/^http:\/\/localhost:8000\/user\/login\?/);
      expect(location).toContain('mcp_state=');
      expect(location).not.toContain('mcp_redirect_uri=');
      expect(location).toContain('state=alpha');

      // Extract mcp_state and verify it's a valid HS256 JWT signed
      // with MCP_JWT_SECRET.
      const mcpState = new URL(location).searchParams.get('mcp_state');
      expect(mcpState).toBeTruthy();
      const decoded = jwt.verify(mcpState!, secret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
      expect(decoded.deviceCode).toBeDefined();
      expect(decoded.mcpCallbackUri).toBeDefined();
      expect(decoded.redirectUri).toBe('http://127.0.0.1:8123/cb');
      expect(decoded.nonce).toBeDefined();
    } finally {
      await close();
    }
  });

  it('returns 400 when user_code is missing', async () => {
    const { agent, close } = await startBridgeMcp();
    try {
      const r = await agent.get(
        '/oauth/authorize/redirect-to-frontend?redirect_uri=http%3A%2F%2F127.0.0.1%3A8123%2Fcb',
      );
      expect(r.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('returns 400 for an invalid user_code', async () => {
    const { agent, close } = await startBridgeMcp();
    try {
      const r = await agent.get(
        '/oauth/authorize/redirect-to-frontend?user_code=ZZZZ-ZZZZ&redirect_uri=http%3A%2F%2F127.0.0.1%3A8123%2Fcb',
      );
      expect(r.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('returns 400 when redirect_uri is missing or invalid', async () => {
    const { agent, close } = await startBridgeMcp();
    try {
      const dev = await agent.post('/oauth/device').send({ client_id: 'claude-code' });
      const { user_code } = dev.body;
      const noRedirect = await agent.get(
        `/oauth/authorize/redirect-to-frontend?user_code=${user_code}`,
      );
      expect(noRedirect.status).toBe(400);
      const badRedirect = await agent.get(
        `/oauth/authorize/redirect-to-frontend?user_code=${user_code}&redirect_uri=https%3A%2F%2Fevil.example.com%2Fcb`,
      );
      expect(badRedirect.status).toBe(400);
    } finally {
      await close();
    }
  });
});
