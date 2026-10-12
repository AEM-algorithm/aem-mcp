import express, { type Application } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { loadEnv } from '../../../src/config/env';
import type { Env } from '../../../src/config/env';
import { createDeviceCodesStore, generateUserCode } from '../../../src/oauth/device-codes';
import { createAuthCodesStore } from '../../../src/oauth/auth-codes';
import { createLoginExchangeRouter } from '../../../src/oauth/login-exchange-handler';
import {
  AemBackendOAuthError,
  AemBackendOAuthErrorCode,
} from '../../../src/clients/aem-backend-oauth-client';

const ENV: Env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: '1234',
  MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
  MCP_BACKEND_OAUTH_EXCHANGE_URL: 'http://127.0.0.1:1',
});

type StubClient = {
  exchange: jest.Mock;
};

function buildApp(
  deviceCodes: ReturnType<typeof createDeviceCodesStore>,
  opts: {
    stub: StubClient;
    oauthEnabled?: boolean;
  },
): Application {
  const router = createLoginExchangeRouter({
    aemBackendOAuth: opts.stub as unknown as never,
    deviceCodes,
    authCodes: createAuthCodesStore(),
    env: ENV,
    oauthEnabled: opts.oauthEnabled ?? true,
  });
  const app = express();
  app.use(router);
  return app;
}

// We need a way to inject the user_code in the GET form. The store's
// `insert` is private in spirit; the public flow is via `issueDeviceCode`,
// but that doesn't return a stable row reference for the test. Use the
// store directly: insert a row with a known user_code.
function insertPendingCode(
  store: ReturnType<typeof createDeviceCodesStore>,
  userCode: string,
): void {
  const now = Date.now();
  store.insert({
    deviceCode: `dev-${userCode}`,
    userCode,
    clientId: 'claude-code',
    scope: 'aem-mcp:read',
    expiresAt: new Date(now + 60_000).toISOString(),
    intervalSeconds: 2,
    status: 'pending',
  });
}

describe('login exchange handler — GET /oauth/authorize', () => {
  it('serves Cursor authorization requests on the root /authorize path', async () => {
    const deviceCodes = createDeviceCodesStore({ verificationUri: 'http://localhost/authorize' });
    const app = buildApp(deviceCodes, { stub: { exchange: jest.fn() } });
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'cursor-test',
      redirect_uri: 'http://localhost:43123/callback',
      state: 'test-state',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
    });

    const res = await request(app).get(`/authorize?${query.toString()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('name="authRequestId"');
  });

  it('renders the form for a valid pending user_code', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const app = buildApp(deviceCodes, { stub: { exchange: jest.fn() } });
    const res = await request(app).get(`/oauth/authorize?user_code=${userCode}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(userCode);
    expect(res.text).toMatch(/name="email"/);
    expect(res.text).toMatch(/name="password"/);
  });

  it('rejects missing user_code with 400', async () => {
    const app = buildApp(createDeviceCodesStore({ verificationUri: 'x' }), { stub: { exchange: jest.fn() } });
    const res = await request(app).get('/oauth/authorize');
    expect(res.status).toBe(400);
  });

  it('rejects malformed user_code with 400', async () => {
    const app = buildApp(createDeviceCodesStore({ verificationUri: 'x' }), { stub: { exchange: jest.fn() } });
    const res = await request(app).get('/oauth/authorize?user_code=not-valid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown user_code', async () => {
    const app = buildApp(createDeviceCodesStore({ verificationUri: 'x' }), { stub: { exchange: jest.fn() } });
    const res = await request(app).get('/oauth/authorize?user_code=ABCD-EFGH');
    expect(res.status).toBe(404);
  });

  it('returns 503 when oauth is disabled', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn() },
      oauthEnabled: false,
    });
    const res = await request(app).get('/oauth/authorize?user_code=ABCD-EFGH');
    expect(res.status).toBe(503);
  });

  it('renders success page when code is already approved', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    // Manually flip to approved
    const row = deviceCodes.get(`dev-${userCode}`);
    if (row) {
      deviceCodes.approve(`dev-${userCode}`, 1, 'jti-approved');
    }
    const app = buildApp(deviceCodes, { stub: { exchange: jest.fn() } });
    const res = await request(app).get(`/oauth/authorize?user_code=${userCode}`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Agent connected/);
  });
});

describe('login exchange handler — POST /oauth/authorize', () => {
  function postForm(
    app: Application,
    body: Record<string, string>,
  ): ReturnType<ReturnType<typeof request>['post']> {
    return request(app)
      .post('/oauth/authorize')
      .type('form')
      .send(body);
  }

  it('rejects invalid email', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const stub = { exchange: jest.fn() };
    const app = buildApp(deviceCodes, { stub });
    const res = await postForm(app, {
      user_code: userCode,
      email: 'not-an-email',
      password: 'pw',
    });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/form-error/);
    expect(stub.exchange).not.toHaveBeenCalled();
  });

  it('calls aem-backend on valid input and approves the device_code on success', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const exchangeCode = jwt.sign(
      { sub: '99', jti: 'jti-99', aud: 'aem-mcp' },
      ENV.MCP_OAUTH_SIGNING_KEY,
      { algorithm: 'HS256', expiresIn: '60s' },
    );
    const stub = {
      exchange: jest.fn().mockResolvedValue({ exchangeCode, userId: 99 }),
    };
    const app = buildApp(deviceCodes, { stub });
    const res = await postForm(app, {
      user_code: userCode,
      email: 'a@b.co',
      password: 'pw',
    });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Agent connected/);
    expect(stub.exchange).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'pw',
      totpCode: undefined,
    });
    const row = deviceCodes.get(`dev-${userCode}`);
    expect(row?.status).toBe('approved');
    expect(row?.userId).toBe(99);
  });

  it('re-renders form with 2FA field when backend returns twoFactorRequired', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const stub = {
      exchange: jest.fn().mockRejectedValue(
        new AemBackendOAuthError(
          AemBackendOAuthErrorCode.TwoFactorRequired,
          '2fa required',
          401,
        ),
      ),
    };
    const app = buildApp(deviceCodes, { stub });
    const res = await postForm(app, {
      user_code: userCode,
      email: 'a@b.co',
      password: 'pw',
    });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/name="totp"/);
    const row = deviceCodes.get(`dev-${userCode}`);
    expect(row?.status).toBe('pending');
  });

  it('re-renders form with "Invalid email or password" on invalidCredentials', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const stub = {
      exchange: jest.fn().mockRejectedValue(
        new AemBackendOAuthError(
          AemBackendOAuthErrorCode.InvalidCredentials,
          'bad creds',
          401,
        ),
      ),
    };
    const app = buildApp(deviceCodes, { stub });
    const res = await postForm(app, {
      user_code: userCode,
      email: 'a@b.co',
      password: 'wrong',
    });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Invalid email or password/);
  });
});
