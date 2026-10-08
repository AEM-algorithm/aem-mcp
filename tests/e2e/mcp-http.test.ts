import http from 'node:http';

import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createMcpApp } from '../../src/server';
import { loadEnv } from '../../src/config/env';
import type { Env } from '../../src/config/env';

/**
 * End-to-end smoke test for the Streamable HTTP transport.
 *
 * Verifies that the MCP server boots, accepts a valid JWT, completes the
 * JSON-RPC `initialize` handshake, and rejects unauthenticated requests
 * with 401. The AEM backend is never actually called because we only
 * exercise protocol-level behavior, not a specific tool.
 */

const TEST_PORT = 0; // ephemeral — let the OS pick a free port
const TEST_JWT_SECRET = 'e2e-smoke-secret';

function makeTestEnv(): Env {
  return loadEnv({
    NODE_ENV: 'test',
    PORT: String(TEST_PORT),
    JWT_SECRET: TEST_JWT_SECRET,
    AEM_BACKEND_URL: 'http://127.0.0.1:1', // never reached in this test
  });
}

function signTestToken(payload: { id: number; [k: string]: unknown }): string {
  return jwt.sign(payload, TEST_JWT_SECRET);
}

describe('e2e: Streamable HTTP MCP transport', () => {
  let server: http.Server;
  let agent: ReturnType<typeof request>;
  let env: Env;

  beforeAll((done) => {
    env = makeTestEnv();
    const app = createMcpApp(env);
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        done(new Error('Failed to bind test server'));
        return;
      }
      agent = request(`http://127.0.0.1:${address.port}`);
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it('GET /health returns ok without auth', async () => {
    const res = await agent.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'aem-mcp' });
  });

  it('GET /ready returns ready without auth', async () => {
    const res = await agent.get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', service: 'aem-mcp' });
  });

  it('POST /mcp without auth returns 401', async () => {
    const res = await agent
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e-smoke', version: '0.0.0' },
        },
      });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /mcp with valid JWT completes initialize handshake', async () => {
    const token = signTestToken({ id: 42, email: 'e2e@example.com' });

    const res = await agent
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e-smoke', version: '0.0.0' },
        },
      });

    // 200 (json) or 200 with SSE framing are both valid for Streamable HTTP.
    expect(res.status).toBe(200);
    // The transport responds on the body or as an SSE event-stream; either
    // way the JSON-RPC `result` must be present and contain serverInfo.
    const body = res.body && Object.keys(res.body).length > 0 ? res.body : res.text;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    expect(text).toMatch(/"serverInfo"\s*:\s*\{[^}]*"name"\s*:\s*"aem-mcp"/);
    expect(text).toMatch(/"protocolVersion"\s*:\s*"2024-11-05"/);
  });

  it('POST /mcp with invalid JWT returns 401', async () => {
    const badToken = jwt.sign({ id: 1 }, 'wrong-secret');

    const res = await agent
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Authorization', `Bearer ${badToken}`)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e-smoke', version: '0.0.0' },
        },
      });

    expect(res.status).toBe(401);
  });
});
