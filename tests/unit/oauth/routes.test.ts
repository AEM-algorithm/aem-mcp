import request from 'supertest';
import express from 'express';

import { createDeviceCodesStore } from '../../../src/oauth/device-codes';
import { createAuthCodesStore } from '../../../src/oauth/auth-codes';
import { createIssuer } from '../../../src/oauth/issuer';
import { createPairingsStore } from '../../../src/oauth/pairings';
import { createRateLimiter } from '../../../src/oauth/rate-limit';
import { createRevocationStore } from '../../../src/oauth/revocation';
import { createOAuthRouter } from '../../../src/oauth/routes';

const KEY = 'a'.repeat(32);
const DEFAULT_DEPS = () => ({
  issuer: createIssuer({ signingKey: KEY }),
  authCodes: createAuthCodesStore(),
  deviceCodes: createDeviceCodesStore({ verificationUri: 'https://aem-mcp/oauth/authorize' }),
  pairings: createPairingsStore(),
  revocation: createRevocationStore(),
  rateLimiter: createRateLimiter({ budgets: { oauth_device: 5, oauth_token: 30 } }),
  oauthEnabled: true,
  verificationUri: 'https://aem-mcp/oauth/authorize',
  deviceCodeTtlSeconds: 600,
  devicePollIntervalSeconds: 2,
});

function appWith(overrides: Partial<ReturnType<typeof DEFAULT_DEPS>> = {}): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createOAuthRouter({ ...DEFAULT_DEPS(), ...overrides }));
  return app;
}

describe('POST /register', () => {
  it('returns client-neutral dynamic registration metadata for any OAuth client', async () => {
    const res = await request(appWith())
      .post('/register')
      .send({
        client_name: 'Gemini CLI',
        redirect_uris: ['http://localhost:43123/callback'],
      });

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({
      client_name: 'Gemini CLI',
      redirect_uris: ['http://localhost:43123/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: expect.arrayContaining(['authorization_code']),
      response_types: ['code'],
    });
    expect(res.body.client_id).toMatch(/^mcp-/);
  });
});

describe('POST /oauth/device', () => {
  it('returns RFC 8628 §3.1 response with correct shape', async () => {
    const app = appWith();
    const res = await request(app).post('/oauth/device').send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.device_code).toBe('string');
    expect(res.body.device_code.length).toBeGreaterThan(20);
    expect(res.body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(res.body.verification_uri).toBe('https://aem-mcp/oauth/authorize');
    expect(res.body.expires_in).toBe(600);
    expect(res.body.interval).toBe(2);
  });

  it('uses default client_id when missing', async () => {
    const deviceCodes = createDeviceCodesStore({ verificationUri: 'x' });
    const app = appWith({ deviceCodes });
    const res = await request(app).post('/oauth/device').send({});
    expect(res.status).toBe(200);
    const row = deviceCodes.get(res.body.device_code);
    expect(row?.clientId).toBe('claude-code');
  });

  it('respects an explicit client_id', async () => {
    const deviceCodes = createDeviceCodesStore({ verificationUri: 'x' });
    const app = appWith({ deviceCodes });
    const res = await request(app)
      .post('/oauth/device')
      .send({ client_id: 'chatgpt-custom' });
    expect(res.status).toBe(200);
    const row = deviceCodes.get(res.body.device_code);
    expect(row?.clientId).toBe('chatgpt-custom');
  });

  it('returns 503 when OAUTH_ENABLED=false', async () => {
    const app = appWith({ oauthEnabled: false });
    const res = await request(app).post('/oauth/device').send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('temporarily_unavailable');
  });

  it('returns 429 after the per-minute budget is exhausted', async () => {
    const rateLimiter = createRateLimiter({ budgets: { oauth_device: 2, oauth_token: 30 } });
    const app = appWith({ rateLimiter });
    await request(app).post('/oauth/device').send({});
    await request(app).post('/oauth/device').send({});
    const res = await request(app).post('/oauth/device').send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('temporarily_unavailable');
    expect(res.headers['retry-after']).toBe('60');
  });
});

describe('POST /oauth/token', () => {
  it('exchanges a Cursor authorization code at the root /token path', async () => {
    const authCodes = createAuthCodesStore();
    const codeVerifier = 'a'.repeat(43);
    authCodes.insert({
      code: 'cursor-auth-code',
      userId: 42,
      jti: 'cursor-jti',
      clientId: 'cursor-client',
      redirectUri: 'http://localhost:43123/callback',
      scope: 'aem-mcp:read',
      codeChallenge: codeVerifier,
      codeChallengeMethod: 'plain',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      consumed: false,
    });
    const app = appWith({ authCodes });

    const res = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'cursor-auth-code',
        client_id: 'cursor-client',
        redirect_uri: 'http://localhost:43123/callback',
        code_verifier: codeVerifier,
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
  });

  it('rejects a wrong grant_type with unsupported_grant_type', async () => {
    const app = appWith();
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'password', device_code: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('rejects a missing device_code with invalid_request', async () => {
    const app = appWith();
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns authorization_pending when status is pending', async () => {
    const deviceCodes = createDeviceCodesStore({ verificationUri: 'x' });
    const app = appWith({ deviceCodes });
    const issued = await request(app).post('/oauth/device').send({});
    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: issued.body.device_code,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('authorization_pending');
  });

  it('returns access_denied when status is denied', async () => {
    const deviceCodes = createDeviceCodesStore({ verificationUri: 'x' });
    const app = appWith({ deviceCodes });
    const issued = await request(app).post('/oauth/device').send({});
    deviceCodes.deny(issued.body.device_code);
    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: issued.body.device_code,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('access_denied');
  });

  it('returns invalid_grant for an unknown device_code', async () => {
    const app = appWith();
    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'does-not-exist',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('mints an access_token and records a pairing when status is approved', async () => {
    const deviceCodes = createDeviceCodesStore({ verificationUri: 'x' });
    const pairings = createPairingsStore();
    const app = appWith({ deviceCodes, pairings });
    const issued = await request(app).post('/oauth/device').send({});
    const deviceCode = issued.body.device_code;
    deviceCodes.approve(deviceCode, 42, 'jti-1');
    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      });
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.scope).toBe('aem-mcp:read');
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.access_token.split('.').length).toBe(3);

    // Pairing recorded
    const pairing = pairings.get('jti-1');
    expect(pairing).toBeDefined();
    expect(pairing?.userId).toBe(42);

    // Device code consumed (one-shot)
    expect(deviceCodes.get(deviceCode)).toBeUndefined();
  });

  it('rate-limits per IP on /oauth/token (D7: 30/min)', async () => {
    const rateLimiter = createRateLimiter({ budgets: { oauth_device: 5, oauth_token: 2 } });
    const app = appWith({ rateLimiter });
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: 'whatever',
        });
      expect(res.status).toBe(400); // invalid_grant, but budget consumed
    }
    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'whatever',
      });
    expect(res.status).toBe(429);
  });
});

describe('POST /oauth/refresh', () => {
  it('returns unsupported_grant_type (D5: no refresh tokens)', async () => {
    const app = appWith();
    const res = await request(app)
      .post('/oauth/refresh')
      .send({ grant_type: 'refresh_token', refresh_token: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('returns 503 when OAUTH_ENABLED=false', async () => {
    const app = appWith({ oauthEnabled: false });
    const res = await request(app)
      .post('/oauth/refresh')
      .send({ grant_type: 'refresh_token', refresh_token: 'x' });
    expect(res.status).toBe(503);
  });
});

describe('POST /oauth/revoke', () => {
  it('returns invalid_request when token is missing', async () => {
    const app = appWith();
    const res = await request(app).post('/oauth/revoke').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('revokes a valid access_token (jti is now in the revocation map)', async () => {
    const issuer = createIssuer({ signingKey: KEY });
    const revocation = createRevocationStore();
    const app = appWith({ issuer, revocation });
    const { token, claims } = issuer.signAccessToken({ userId: 7 });
    const res = await request(app).post('/oauth/revoke').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(revocation.isRevoked(claims.jti)).toBe(true);
  });

  it('still returns 200 for an unknown/invalid token (RFC 7009 §2.2)', async () => {
    const app = appWith();
    const res = await request(app).post('/oauth/revoke').send({ token: 'not-a-jwt' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
