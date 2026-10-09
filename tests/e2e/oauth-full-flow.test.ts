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
      if (email === 'twofa@b.co' && !totpCode) {
        res.status(401).json({ error: 'twoFactorRequired' });
        return;
      }
      if (email === 'bad@b.co' || password === 'wrong') {
        res.status(401).json({ error: 'invalidCredentials' });
        return;
      }
      const userId = email === 'a@b.co' ? 1 : email === 'c@d.co' ? 2 : 99;
      const exchangeCode = jwt.sign(
        { sub: String(userId), jti: `jti-${userId}-${Date.now()}`, aud: 'aem-mcp' },
        MCP_OAUTH_SIGNING_KEY,
        { algorithm: 'HS256', expiresIn: '60s' },
      );
      res.status(200).json({ exchangeCode, userId });
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
    const getForm = await mcpAgent.get(`/oauth/authorize?user_code=${user_code}`);
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
