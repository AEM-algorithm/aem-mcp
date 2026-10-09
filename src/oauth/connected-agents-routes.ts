// Connected-agents API (Phase 6).
//
//   GET    /api/agents       — list the caller's pairings (most-recent first)
//   DELETE /api/agents/:jti  — revoke a specific pairing owned by the caller
//
// Auth: the same dual-path as `/mcp` (Bearer MCP access token OR session
// cookie). On success the response uses the standard JSON envelope
// `{ ok: true, data, error: null }` per standards.md `api/response-format`.

import express, { type Request, type Response, Router } from 'express';

import type { Env } from '../config/env';
import { AuthError, verifySessionToken } from '../auth/verify-session-token';
import { AccessTokenError, verifyAccessToken } from './access-token-verify';
import type { PairingsStore } from './pairings';
import type { RevocationStore } from './revocation';

export type ConnectedAgentsDeps = {
  env: Env;
  pairings: PairingsStore;
  revocation: RevocationStore;
};

type ResolvedCaller =
  | { kind: 'mcp-access-token'; userId: number; jti: string; token: string }
  | { kind: 'session'; userId: number; token: string };

function resolveCaller(req: Request, deps: ConnectedAgentsDeps): ResolvedCaller {
  const authorization = req.header('authorization');
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    const claims = verifyAccessToken(token, deps.env);
    if (deps.revocation.isRevoked(claims.jti)) {
      throw new AuthError('Access token has been revoked');
    }
    return { kind: 'mcp-access-token', userId: claims.userId, jti: claims.jti, token };
  }
  const cookie = req.header('cookie');
  if (!cookie) {
    throw new AuthError('Missing session token');
  }
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  if (!match?.[1]) {
    throw new AuthError('Missing session token');
  }
  const session = verifySessionToken(decodeURIComponent(match[1].trim()), deps.env);
  return { kind: 'session', userId: session.userId, token: match[1].trim() };
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, data: null, error: { code, message } });
}

function sendData<T>(res: Response, data: T): void {
  res.status(200).json({ ok: true, data, error: null });
}

export function createConnectedAgentsRouter(deps: ConnectedAgentsDeps): Router {
  const router = Router();
  router.use(express.json());

  // ---- GET /api/agents ----
  router.get('/api/agents', (req: Request, res: Response): void => {
    try {
      const caller = resolveCaller(req, deps);
      const list = deps.pairings.listByUser(caller.userId);
      const sorted = [...list].sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
      sendData(res, {
        agents: sorted.map((p) => ({
          jti: p.jti,
          clientId: p.clientId,
          userCode: p.userCode,
          approvedAt: p.approvedAt,
        })),
      });
    } catch (error) {
      if (error instanceof AuthError || error instanceof AccessTokenError) {
        sendError(res, 401, 'unauthorized', error.message);
        return;
      }
      sendError(res, 500, 'server_error', 'failed to list agents');
    }
  });

  // ---- DELETE /api/agents/:jti ----
  router.delete('/api/agents/:jti', (req: Request, res: Response): void => {
    try {
      const caller = resolveCaller(req, deps);
      const jtiParam = req.params.jti;
      if (typeof jtiParam !== 'string' || jtiParam.length === 0) {
        sendError(res, 400, 'invalid_request', 'jti is required');
        return;
      }
      const pairing = deps.pairings.get(jtiParam);
      if (!pairing || pairing.userId !== caller.userId) {
        // RFC 7009-style: do not leak existence; return 404
        sendError(res, 404, 'not_found', 'agent not found');
        return;
      }
      deps.revocation.revoke(pairing.jti, pairing.clientId);
      deps.pairings.remove(pairing.jti);
      sendData(res, { revoked: pairing.jti });
    } catch (error) {
      if (error instanceof AuthError || error instanceof AccessTokenError) {
        sendError(res, 401, 'unauthorized', error.message);
        return;
      }
      sendError(res, 500, 'server_error', 'failed to revoke agent');
    }
  });

  return router;
}
