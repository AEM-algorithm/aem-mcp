import express, { type Application } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { loadEnv } from '../../../src/config/env';
import type { Env } from '../../../src/config/env';
import { createConnectedAgentsRouter } from '../../../src/oauth/connected-agents-routes';
import { createPairingsStore } from '../../../src/oauth/pairings';
import { createRevocationStore } from '../../../src/oauth/revocation';

const ENV: Env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: '1234',
  MCP_OAUTH_SIGNING_KEY: 'a'.repeat(32),
});

const SESSION_JWT_SECRET = ENV.JWT_SECRET;

function buildApp(): Application {
  const pairings = createPairingsStore();
  const revocation = createRevocationStore();
  const router = createConnectedAgentsRouter({ env: ENV, pairings, revocation });
  const app = express();
  app.use(router);
  return app;
}

function signSession(userId: number): string {
  return jwt.sign({ id: userId, email: 'a@b.co' }, SESSION_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '60s',
  });
}

function signAccess(userId: number, jti: string, scope = 'aem-mcp:read'): string {
  return jwt.sign({ sub: String(userId), jti, aud: 'aem-mcp', scope }, ENV.MCP_OAUTH_SIGNING_KEY, {
    algorithm: 'HS256',
    expiresIn: '60s',
  });
}

function addPairing(
  app: Application,
  userId: number,
  jti: string,
  clientId = 'claude-code',
  userCode = 'ABCD-EFGH',
): void {
  // Reach into the app's router: the simplest way is to construct stores
  // independently and add them. But `buildApp` returns a fresh app per call,
  // so we need to expose pairings. For testing, attach stores to the app
  // so tests can read them.
  const stores = (app as unknown as { _stores?: { pairings: ReturnType<typeof createPairingsStore>; revocation: ReturnType<typeof createRevocationStore> } })._stores;
  if (!stores) {
    throw new Error('Test app does not expose stores; refactor required');
  }
  stores.pairings.add({
    jti,
    userId,
    clientId,
    userCode,
    approvedAt: new Date().toISOString(),
    deviceCode: `dev-${jti}`,
  });
}

function buildAppWithStores(): {
  app: Application;
  pairings: ReturnType<typeof createPairingsStore>;
  revocation: ReturnType<typeof createRevocationStore>;
} {
  const pairings = createPairingsStore();
  const revocation = createRevocationStore();
  const router = createConnectedAgentsRouter({ env: ENV, pairings, revocation });
  const app = express();
  app.use(router);
  (app as unknown as { _stores: unknown })._stores = { pairings, revocation };
  return { app, pairings, revocation };
}

describe('GET /api/agents', () => {
  it('returns the caller\'s pairings, most-recent first', async () => {
    const { app, pairings } = buildAppWithStores();
    pairings.add({
      jti: 'jti-1',
      userId: 1,
      clientId: 'claude-code',
      userCode: 'AAAA-1111',
      approvedAt: '2026-10-09T10:00:00.000Z',
      deviceCode: 'dev-1',
    });
    pairings.add({
      jti: 'jti-2',
      userId: 1,
      clientId: 'chatgpt',
      userCode: 'BBBB-2222',
      approvedAt: '2026-10-09T10:05:00.000Z',
      deviceCode: 'dev-2',
    });
    pairings.add({
      jti: 'jti-3',
      userId: 2, // other user
      clientId: 'codex',
      userCode: 'CCCC-3333',
      approvedAt: '2026-10-09T10:10:00.000Z',
      deviceCode: 'dev-3',
    });

    const token = signSession(1);
    const res = await request(app)
      .get('/api/agents')
      .set('cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.agents).toHaveLength(2);
    expect(res.body.data.agents[0].jti).toBe('jti-2');
    expect(res.body.data.agents[1].jti).toBe('jti-1');
  });

  it('returns empty list for caller with no pairings', async () => {
    const { app } = buildAppWithStores();
    const token = signSession(1);
    const res = await request(app)
      .get('/api/agents')
      .set('cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.agents).toEqual([]);
  });

  it('returns 401 without auth', async () => {
    const { app } = buildAppWithStores();
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(401);
  });

  it('accepts a Bearer MCP access token', async () => {
    const { app, pairings } = buildAppWithStores();
    pairings.add({
      jti: 'jti-bearer',
      userId: 7,
      clientId: 'claude-code',
      userCode: 'DDDD-4444',
      approvedAt: '2026-10-09T11:00:00.000Z',
      deviceCode: 'dev-bearer',
    });
    const token = signAccess(7, 'jti-bearer');
    const res = await request(app)
      .get('/api/agents')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.agents).toHaveLength(1);
    expect(res.body.data.agents[0].jti).toBe('jti-bearer');
  });

  it('rejects a Bearer token whose jti is revoked', async () => {
    const { app, pairings, revocation } = buildAppWithStores();
    pairings.add({
      jti: 'jti-rev',
      userId: 7,
      clientId: 'claude-code',
      userCode: 'EEEE-5555',
      approvedAt: '2026-10-09T11:00:00.000Z',
      deviceCode: 'dev-rev',
    });
    revocation.revoke('jti-rev', 'claude-code');
    const token = signAccess(7, 'jti-rev');
    const res = await request(app)
      .get('/api/agents')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/agents/:jti', () => {
  it('revokes a pairing owned by the caller', async () => {
    const { app, pairings, revocation } = buildAppWithStores();
    pairings.add({
      jti: 'jti-del',
      userId: 1,
      clientId: 'claude-code',
      userCode: 'FFFF-6666',
      approvedAt: '2026-10-09T12:00:00.000Z',
      deviceCode: 'dev-del',
    });
    const token = signSession(1);
    const res = await request(app)
      .delete('/api/agents/jti-del')
      .set('cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.revoked).toBe('jti-del');
    expect(revocation.isRevoked('jti-del')).toBe(true);
    expect(pairings.get('jti-del')).toBeUndefined();
  });

  it('returns 404 when trying to revoke another user\'s pairing', async () => {
    const { app, pairings } = buildAppWithStores();
    pairings.add({
      jti: 'jti-other',
      userId: 2,
      clientId: 'claude-code',
      userCode: 'GGGG-7777',
      approvedAt: '2026-10-09T12:00:00.000Z',
      deviceCode: 'dev-other',
    });
    const token = signSession(1);
    const res = await request(app)
      .delete('/api/agents/jti-other')
      .set('cookie', `token=${token}`);
    expect(res.status).toBe(404);
    // The pairing must still exist
    expect(pairings.get('jti-other')).toBeDefined();
  });

  it('returns 404 for an unknown jti', async () => {
    const { app } = buildAppWithStores();
    const token = signSession(1);
    const res = await request(app)
      .delete('/api/agents/does-not-exist')
      .set('cookie', `token=${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const { app } = buildAppWithStores();
    const res = await request(app).delete('/api/agents/whatever');
    expect(res.status).toBe(401);
  });
});
