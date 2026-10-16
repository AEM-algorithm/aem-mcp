import express, { type Application } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createHash } from 'node:crypto';

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
  MCP_FRONTEND_URL: 'http://localhost:8000',
  PUBLIC_URL: 'http://localhost:7000',
});

type StubClient = {
  exchange: jest.Mock;
  exchangeBySession: jest.Mock;
};

function buildApp(
  deviceCodes: ReturnType<typeof createDeviceCodesStore>,
  opts: {
    stub: StubClient;
    oauthEnabled?: boolean;
    env?: Env;
  },
): Application {
  const router = createLoginExchangeRouter({
    aemBackendOAuth: opts.stub as unknown as never,
    deviceCodes,
    authCodes: createAuthCodesStore(),
    env: opts.env ?? ENV,
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

// Build a valid exchangeCode JWT for use in session-reuse tests.
function makeExchangeCode(
  sub: string,
  jti: string,
  binding: { deviceCode?: string; authRequestId?: string } = {},
): string {
  return jwt.sign({ sub, aud: 'aem-mcp', jti, ...binding }, ENV.MCP_OAUTH_SIGNING_KEY, {
    algorithm: 'HS256',
    expiresIn: '60s',
  });
}

// Stub that always rejects exchangeBySession with InvalidSession.
function stubInvalidSession(): StubClient {
  return {
    exchange: jest.fn(),
    exchangeBySession: jest.fn().mockRejectedValue(
      new AemBackendOAuthError(
        AemBackendOAuthErrorCode.InvalidSession,
        'expired',
        401,
      ),
    ),
  };
}

// Stub that resolves exchangeBySession with a valid exchangeCode.
function stubValidSession(exchangeCode: string): StubClient {
  return {
    exchange: jest.fn(),
    exchangeBySession: jest.fn().mockResolvedValue({ exchangeCode }),
  };
}

describe('login exchange handler — GET /oauth/authorize', () => {
  it('serves Gemini CLI authorization requests on a dynamic loopback callback', async () => {
    const deviceCodes = createDeviceCodesStore({ verificationUri: 'http://localhost/authorize' });
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'gemini-cli-test',
      redirect_uri: 'http://localhost:43123/callback',
      state: 'test-state',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
    });

    const res = await request(app).get(`/authorize?${query.toString()}&bridge=0`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('name="authRequestId"');
  });

  it('accepts Gemini CLI authorization requests using an IPv6 loopback callback', async () => {
    const app = buildApp(createDeviceCodesStore(), {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const res = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: 'gemini-cli-test',
      redirect_uri: 'http://[::1]:43123/oauth/callback',
      state: 'ipv6-state',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin).toBe('http://localhost:8000');
    expect(location.searchParams.get('mcp_state')).toBeTruthy();
  });

  it('accepts Gemini Connected Apps OAuth relay callbacks', async () => {
    const app = buildApp(createDeviceCodesStore(), {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const redirectUri =
      'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-100759728686723321902-mcp-staging_aem_ac';
    const res = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: 'gemini-web-test',
      redirect_uri: redirectUri,
      state: 'gemini-state',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin).toBe('http://localhost:8000');
    expect(location.searchParams.get('mcp_state')).toBeTruthy();
  });

  it('rejects lookalike hosts for Gemini Connected Apps callbacks', async () => {
    const app = buildApp(createDeviceCodesStore(), {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const res = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: 'gemini-web-test',
      redirect_uri:
        'https://oauth-redirect.googleusercontent.com.attacker.example/r/user_bound_custom-mcp-123',
      state: 'gemini-state',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
    });

    expect(res.status).toBe(400);
    expect(res.text).toContain('Invalid redirect_uri');
  });

  it('redirects the default PKCE authorize request to frontend with a signed authRequestId', async () => {
    const app = buildApp(createDeviceCodesStore(), {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'gemini-cli-test',
      redirect_uri: 'http://127.0.0.1:43123/callback',
      state: 'client-state',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    });

    const response = await request(app).get(`/oauth/authorize?${query.toString()}`);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.origin).toBe('http://localhost:8000');
    expect(location.searchParams.has('mcp_redirect_uri')).toBe(false);
    const mcpState = jwt.verify(
      location.searchParams.get('mcp_state')!,
      ENV.MCP_JWT_SECRET,
      { algorithms: ['HS256'] },
    ) as jwt.JwtPayload;
    expect(mcpState.authRequestId).toBeDefined();
    expect(mcpState.mcpCallbackUri).toBe('http://localhost:7000/oauth/authorize/agent-callback');
  });

  it('renders the form for a valid pending user_code', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const res = await request(app).get(`/oauth/authorize?user_code=${userCode}&bridge=0`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(userCode);
    expect(res.text).toContain(`name="user_code" value="${userCode}"`);
    expect(res.text).toMatch(/name="email"/);
    expect(res.text).toMatch(/name="password"/);
  });

  it('renders a manual-entry form when user_code is missing', async () => {
    const app = buildApp(createDeviceCodesStore({ verificationUri: 'x' }), {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const res = await request(app).get('/oauth/authorize');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Enter the valid device code shown by your agent.');
    expect(res.text).toContain('name="user_code"');
    expect(res.text).toMatch(/name="email"/);
    expect(res.text).toMatch(/name="password"/);
  });

  it('renders a manual-entry form when user_code is malformed', async () => {
    const app = buildApp(createDeviceCodesStore({ verificationUri: 'x' }), {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const res = await request(app).get('/oauth/authorize?user_code=not-valid');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Enter the valid device code shown by your agent.');
    expect(res.text).toContain('name="user_code"');
  });

  it('renders a manual-entry form when user_code is unknown', async () => {
    const app = buildApp(createDeviceCodesStore({ verificationUri: 'x' }), {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const res = await request(app).get('/oauth/authorize?user_code=ABCD-EFGH');
    expect(res.status).toBe(200);
    expect(res.text).toContain('This device code has expired or is not valid.');
    expect(res.text).toContain('name="user_code"');
  });

  it('redirects the default device flow to frontend with a signed MCP callback target', async () => {
    const deviceCodes = createDeviceCodesStore();
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });

    const response = await request(app).get(
      `/oauth/authorize?response_type=device_code&user_code=${userCode}`,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.origin).toBe('http://localhost:8000');
    expect(location.searchParams.has('mcp_redirect_uri')).toBe(false);
    const state = location.searchParams.get('mcp_state');
    expect(state).toBeTruthy();
    expect(jwt.verify(state!, ENV.MCP_JWT_SECRET, { algorithms: ['HS256'] })).toMatchObject({
      deviceCode: `dev-${userCode}`,
      mcpCallbackUri: 'http://localhost:7000/oauth/authorize/agent-callback',
    });
  });

  it('returns 503 when the default bridge has no frontend URL configured', async () => {
    const deviceCodes = createDeviceCodesStore();
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
      env: loadEnv({
        NODE_ENV: 'test',
        JWT_SECRET: '1234',
        MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
      }),
    });

    const response = await request(app).get(`/oauth/authorize?user_code=${userCode}`);

    expect(response.status).toBe(503);
    expect(response.text).toContain('MCP_FRONTEND_URL is not configured');
  });

  it('returns 503 when oauth is disabled', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
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
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });
    const res = await request(app).get(`/oauth/authorize?user_code=${userCode}&bridge=0`);
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
    const stub = {
      exchange: jest.fn(),
      exchangeBySession: jest.fn(),
    };
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
      exchangeBySession: jest.fn(),
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
      exchangeBySession: jest.fn(),
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
      exchangeBySession: jest.fn(),
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

describe('login exchange handler — session-reuse path', () => {
  it('auto-approves a pending device code when a valid session cookie is forwarded', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);

    const exchangeCode = makeExchangeCode('1', 'test-jti-1');
    const stub = stubValidSession(exchangeCode);
    const app = buildApp(deviceCodes, { stub });

    const res = await request(app)
      .get(`/oauth/authorize?user_code=${userCode}&bridge=0`)
      .set('Cookie', 'token=valid-jwt');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/Agent connected/);

    // Device code should be auto-approved by the session.
    const row = deviceCodes.get(`dev-${userCode}`);
    expect(row?.status).toBe('approved');
    expect(row?.userId).toBe(1);
  });

  it('falls through to the form when the session cookie is rejected', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);

    const stub = stubInvalidSession();
    const app = buildApp(deviceCodes, { stub });

    const res = await request(app)
      .get(`/oauth/authorize?user_code=${userCode}&bridge=0`)
      .set('Cookie', 'token=expired-jwt');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(userCode);
    expect(res.text).toMatch(/name="email"/);
    expect(res.text).toMatch(/name="password"/);

    // Device code should remain pending since session was rejected.
    const row = deviceCodes.get(`dev-${userCode}`);
    expect(row?.status).toBe('pending');
  });

  it('falls through to the form when no session cookie is present', async () => {
    const deviceCodes = createDeviceCodesStore({
      verificationUri: 'http://localhost/oauth/authorize',
    });
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);

    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });

    // No Cookie header at all.
    const res = await request(app).get(`/oauth/authorize?user_code=${userCode}&bridge=0`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(userCode);
    expect(res.text).toMatch(/name="email"/);
    expect(res.text).toMatch(/name="password"/);
  });

  it('renders a "no pending request" message when session is valid but no device_code and no auth_request_id', async () => {
    const exchangeCode = makeExchangeCode('1', 'test-jti-2');
    const stub = stubValidSession(exchangeCode);
    const app = buildApp(createDeviceCodesStore({ verificationUri: 'x' }), { stub });

    // GET with no query params (no user_code, no auth_request_id).
    const res = await request(app)
      .get('/oauth/authorize')
      .set('Cookie', 'token=valid-jwt');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(
      'Session recognized but no pending authorization request found',
    );
  });
});

describe('login exchange handler — agent binding callback route', () => {
  it('registers the callback and approves the device identified by the exchange code', async () => {
    const deviceCodes = createDeviceCodesStore();
    const userCode = generateUserCode();
    insertPendingCode(deviceCodes, userCode);
    const app = buildApp(deviceCodes, {
      stub: { exchange: jest.fn(), exchangeBySession: jest.fn() },
    });

    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeExchangeCode('1', 'stable-jti', { deviceCode: `dev-${userCode}` }) });

    expect(response.status).toBe(200);
    expect(response.text).toContain('Device paired');
    expect(deviceCodes.get(`dev-${userCode}`)).toMatchObject({
      status: 'approved',
      userId: 1,
      jti: 'stable-jti',
    });
  });

  it('returns a PKCE authorization code to the saved client callback after frontend login', async () => {
    const authCodes = createAuthCodesStore();
    const app = express();
    app.use(createLoginExchangeRouter({
      aemBackendOAuth: { exchange: jest.fn(), exchangeBySession: jest.fn() } as unknown as never,
      deviceCodes: createDeviceCodesStore(),
      authCodes,
      env: ENV,
      oauthEnabled: true,
    }));
    const redirectUri = 'http://127.0.0.1:43123/callback';
    const codeVerifier = 'v'.repeat(43);
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const authorize = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: 'gemini-cli-test',
      redirect_uri: redirectUri,
      state: 'client-state',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    const stateToken = new URL(authorize.headers.location).searchParams.get('mcp_state')!;
    const signedState = jwt.verify(stateToken, ENV.MCP_JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const exchangeCode = makeExchangeCode('390', 'stable-pkce-jti', {
      authRequestId: signedState.authRequestId as string,
    });

    const callback = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: exchangeCode });

    expect(callback.status).toBe(302);
    const clientLocation = new URL(callback.headers.location);
    expect(clientLocation.origin + clientLocation.pathname).toBe(redirectUri);
    expect(clientLocation.searchParams.get('state')).toBe('client-state');
    expect(clientLocation.searchParams.get('iss')).toBe('http://localhost:7000');
    const authorizationCode = clientLocation.searchParams.get('code')!;
    expect(authCodes.consume(authorizationCode, { codeVerifier, redirectUri })).toMatchObject({
      userId: 390,
      jti: 'stable-pkce-jti',
      clientId: 'gemini-cli-test',
      redirectUri,
      codeChallenge,
    });

    const retry = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: exchangeCode });
    expect(retry.status).toBe(302);
    expect(retry.headers.location).toBe(callback.headers.location);

    const differentBinding = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({
        code: makeExchangeCode('390', 'different-jti', {
          authRequestId: signedState.authRequestId as string,
        }),
      });
    expect(differentBinding.status).toBe(400);

    const missingPending = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeExchangeCode('390', 'unknown-jti', { authRequestId: 'unknown-request' }) });
    expect(missingPending.status).toBe(400);
  });
});
