import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { loadEnv } from '../../../src/config/env';
import { createAuthCodesStore } from '../../../src/oauth/auth-codes';
import { createDeviceCodesStore } from '../../../src/oauth/device-codes';
import { OAuthError } from '../../../src/oauth/errors';
import { makeHandleAgentBindCallback } from '../../../src/oauth/agent-bind-callback';
import * as exchangeCodeVerify from '../../../src/oauth/exchange-code-verify';
import { audit } from '../../../src/utils/audit';

const ENV = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret',
  MCP_OAUTH_SIGNING_KEY: 'm'.repeat(32),
});

function makeCode(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    { sub: '390', aud: 'aem-mcp', jti: 'jti-agent-1', ...claims },
    ENV.MCP_OAUTH_SIGNING_KEY,
    { algorithm: 'HS256', expiresIn: 60 },
  );
}

function makeApp(deviceCodes = createDeviceCodesStore()) {
  const app = express();
  app.get(
    '/oauth/authorize/agent-callback',
    makeHandleAgentBindCallback({
      env: ENV,
      deviceCodes,
      authCodes: createAuthCodesStore(),
      consumeAuthRequest: () => undefined,
    }),
  );
  return { app, deviceCodes };
}

function insertPending(deviceCodes: ReturnType<typeof createDeviceCodesStore>) {
  const row = {
    deviceCode: 'opaque-device-code-1',
    userCode: 'ABCD-EFGH',
    clientId: 'test-agent',
    scope: 'aem-mcp:read',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    intervalSeconds: 5,
    status: 'pending' as const,
  };
  deviceCodes.insert(row);
  return row;
}

describe('GET /oauth/authorize/agent-callback', () => {
  afterEach(() => jest.restoreAllMocks());

  it('approves the exact device from the verified exchange code', async () => {
    const deviceCodes = createDeviceCodesStore();
    const row = insertPending(deviceCodes);
    const auditSpy = jest.spyOn(audit, 'mcpAgentBindingForwarded');
    const { app } = makeApp(deviceCodes);

    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeCode({ deviceCode: row.deviceCode }) });

    expect(response.status).toBe(200);
    expect(response.text).toContain('Device paired');
    expect(deviceCodes.get(row.deviceCode)).toMatchObject({
      status: 'approved',
      userId: 390,
      jti: 'jti-agent-1',
    });
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith({ userId: 390, jti: 'jti-agent-1' });
  });

  it('rejects a missing exchange code', async () => {
    const { app } = makeApp();
    const response = await request(app).get('/oauth/authorize/agent-callback');

    expect(response.status).toBe(400);
    expect(response.text).toContain('code is required');
  });

  it('rejects an empty exchange code', async () => {
    const { app } = makeApp();
    const response = await request(app).get('/oauth/authorize/agent-callback?code=');
    expect(response.status).toBe(400);
    expect(response.text).toContain('code is required');
  });

  it.each(['malformed', 'expired'])(
    'rejects a %s exchange code without approving a device', async (kind) => {
      const deviceCodes = createDeviceCodesStore();
      const row = insertPending(deviceCodes);
      const auditSpy = jest.spyOn(audit, 'mcpAgentBindingForwarded');
      const { app } = makeApp(deviceCodes);
      const code = kind === 'expired'
        ? jwt.sign(
            { sub: '390', aud: 'aem-mcp', jti: 'jti-expired', deviceCode: row.deviceCode },
            ENV.MCP_OAUTH_SIGNING_KEY,
            { algorithm: 'HS256', expiresIn: -1 },
          )
        : 'not-a-jwt';

      const response = await request(app)
        .get('/oauth/authorize/agent-callback')
        .query({ code });

      expect(response.status).toBe(400);
      expect(deviceCodes.get(row.deviceCode)?.status).toBe('pending');
      expect(auditSpy).not.toHaveBeenCalled();
      expect(response.text).not.toContain(code);
    },
  );

  it('rejects an exchange code without a deviceCode claim', async () => {
    const deviceCodes = createDeviceCodesStore();
    const row = insertPending(deviceCodes);
    const auditSpy = jest.spyOn(audit, 'mcpAgentBindingForwarded');
    const { app } = makeApp(deviceCodes);

    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeCode() });

    expect(response.status).toBe(400);
    expect(deviceCodes.get(row.deviceCode)?.status).toBe('pending');
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('rejects an exchange code that names no existing device', async () => {
    const { app } = makeApp();
    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeCode({ deviceCode: 'unknown-device' }) });
    expect(response.status).toBe(400);
  });

  it('rejects a denied device', async () => {
    const deviceCodes = createDeviceCodesStore();
    const row = insertPending(deviceCodes);
    deviceCodes.deny(row.deviceCode);
    const { app } = makeApp(deviceCodes);
    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeCode({ deviceCode: row.deviceCode }) });
    expect(response.status).toBe(400);
  });

  it('allows an identical binding retry without a second audit event', async () => {
    const deviceCodes = createDeviceCodesStore();
    const row = insertPending(deviceCodes);
    const code = makeCode({ deviceCode: row.deviceCode });
    const auditSpy = jest.spyOn(audit, 'mcpAgentBindingForwarded');
    const { app } = makeApp(deviceCodes);

    const first = await request(app).get('/oauth/authorize/agent-callback').query({ code });
    const second = await request(app).get('/oauth/authorize/agent-callback').query({ code });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a retry with a different binding for an already approved device', async () => {
    const deviceCodes = createDeviceCodesStore();
    const row = insertPending(deviceCodes);
    deviceCodes.approve(row.deviceCode, 390, 'original-jti');
    const auditSpy = jest.spyOn(audit, 'mcpAgentBindingForwarded');
    const { app } = makeApp(deviceCodes);

    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeCode({ deviceCode: row.deviceCode, jti: 'different-jti' }) });

    expect(response.status).toBe(400);
    expect(response.text).not.toContain('different-jti');
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('returns an opaque error if approving the pending device fails', async () => {
    const store = createDeviceCodesStore();
    const row = insertPending(store);
    const deviceCodes = {
      ...store,
      approve: jest.fn(() => {
        throw new OAuthError('invalid_grant', 'sensitive internal detail', 400);
      }),
    };
    const auditSpy = jest.spyOn(audit, 'mcpAgentBindingForwarded');
    const { app } = makeApp(deviceCodes);

    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeCode({ deviceCode: row.deviceCode }) });

    expect(response.status).toBe(400);
    expect(response.text).not.toContain('sensitive internal detail');
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('returns an opaque 500 when exchange-code verification throws unexpectedly', async () => {
    jest.spyOn(exchangeCodeVerify, 'verifyExchangeCode').mockImplementation(() => {
      throw new Error('internal verification detail');
    });
    const { app } = makeApp();

    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: 'some-code' });

    expect(response.status).toBe(500);
    expect(response.text).not.toContain('internal verification detail');
  });

  it('returns an opaque 500 when device approval throws unexpectedly', async () => {
    const store = createDeviceCodesStore();
    const row = insertPending(store);
    const deviceCodes = {
      ...store,
      approve: jest.fn(() => {
        throw new Error('internal approval detail');
      }),
    };
    const { app } = makeApp(deviceCodes);

    const response = await request(app)
      .get('/oauth/authorize/agent-callback')
      .query({ code: makeCode({ deviceCode: row.deviceCode }) });

    expect(response.status).toBe(500);
    expect(response.text).not.toContain('internal approval detail');
  });
});
