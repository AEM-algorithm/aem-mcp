import type { Request, Response } from 'express';

import type { Env } from '../config/env';
import { audit } from '../utils/audit';
import { AUTH_CODE_TTL_SECONDS, generateAuthorizationCode, type AuthCodesStore } from './auth-codes';
import type { DeviceCodesStore } from './device-codes';
import { OAuthError } from './errors';
import { verifyExchangeCode, ExchangeCodeError } from './exchange-code-verify';
import { getOAuthResourceBaseUrl } from './resource';

export type PendingAuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'plain' | 'S256';
  scope: string;
  resource?: string;
};

type AgentBindCallbackDeps = {
  env: Env;
  deviceCodes: DeviceCodesStore;
  authCodes: AuthCodesStore;
  consumeAuthRequest: (authRequestId: string) => PendingAuthorizationRequest | undefined;
};

type CompletedAuthCallback = {
  userId: number;
  jti: string;
  redirectLocation: string;
  expiresAt: number;
};

const completedAuthCallbacks = new Map<string, CompletedAuthCallback>();

const PAIRED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Device paired</title></head>
<body><main><h1>Device paired</h1><p>You can close this page and return to your agent.</p></main></body></html>`;

const ERROR_PAGE = '<!doctype html><html lang="en"><body><p>Authorization could not be completed. Return to your agent and restart sign-in.</p></body></html>';

function sendPage(res: Response, status: number, body: string): void {
  res
    .status(status)
    .set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    })
    .type('html')
    .send(body);
}

function handlePkceCallback(
  res: Response,
  deps: AgentBindCallbackDeps,
  verified: { userId: number; jti: string; authRequestId: string },
): void {
  const now = Date.now();
  for (const [id, completed] of completedAuthCallbacks) {
    if (completed.expiresAt <= now) completedAuthCallbacks.delete(id);
  }

  const completed = completedAuthCallbacks.get(verified.authRequestId);
  if (completed) {
    if (completed.userId === verified.userId && completed.jti === verified.jti) {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.redirect(302, completed.redirectLocation);
      return;
    }
    sendPage(res, 400, ERROR_PAGE);
    return;
  }

  const pending = deps.consumeAuthRequest(verified.authRequestId);
  if (!pending) {
    sendPage(res, 400, ERROR_PAGE);
    return;
  }

  const code = generateAuthorizationCode();
  deps.authCodes.insert({
    code,
    userId: verified.userId,
    jti: verified.jti,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    resource: pending.resource,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    expiresAt: new Date(now + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
    consumed: false,
  });

  const params = new URLSearchParams({
    code,
    iss: getOAuthResourceBaseUrl(deps.env.PUBLIC_URL, deps.env.PORT),
  });
  if (pending.state) params.set('state', pending.state);
  const redirectLocation = `${pending.redirectUri}?${params.toString()}`;
  completedAuthCallbacks.set(verified.authRequestId, {
    userId: verified.userId,
    jti: verified.jti,
    redirectLocation,
    expiresAt: now + AUTH_CODE_TTL_SECONDS * 1000,
  });
  audit.deviceApproved({
    userCode: `authcode:${pending.clientId.slice(0, 12)}`,
    userId: verified.userId,
    jti: verified.jti,
    clientId: pending.clientId,
  });
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.redirect(302, redirectLocation);
}

export function makeHandleAgentBindCallback(deps: AgentBindCallbackDeps) {
  const { env, deviceCodes } = deps;
  return function handleAgentBindCallback(req: Request, res: Response): void {
    const rawCode = req.query.code;
    if (typeof rawCode !== 'string' || rawCode.length === 0) {
      res.status(400).type('text/plain').send('code is required');
      return;
    }

    let verified;
    try {
      verified = verifyExchangeCode(rawCode, env);
    } catch (error) {
      if (error instanceof ExchangeCodeError) {
        sendPage(res, 400, ERROR_PAGE);
        return;
      }
      sendPage(res, 500, ERROR_PAGE);
      return;
    }

    if (verified.authRequestId) {
      handlePkceCallback(res, deps, {
        userId: verified.userId,
        jti: verified.jti,
        authRequestId: verified.authRequestId,
      });
      return;
    }

    if (!verified.deviceCode) {
      sendPage(res, 400, ERROR_PAGE);
      return;
    }

    const row = deviceCodes.get(verified.deviceCode);
    if (!row) {
      sendPage(res, 400, ERROR_PAGE);
      return;
    }

    if (row.status === 'approved') {
      if (row.userId === verified.userId && row.jti === verified.jti) {
        sendPage(res, 200, PAIRED_PAGE);
        return;
      }
      sendPage(res, 400, ERROR_PAGE);
      return;
    }

    if (row.status !== 'pending') {
      sendPage(res, 400, ERROR_PAGE);
      return;
    }

    try {
      deviceCodes.approve(verified.deviceCode, verified.userId, verified.jti);
      audit.mcpAgentBindingForwarded({ userId: verified.userId, jti: verified.jti });
      sendPage(res, 200, PAIRED_PAGE);
    } catch (error) {
      if (error instanceof OAuthError) {
        sendPage(res, 400, ERROR_PAGE);
        return;
      }
      sendPage(res, 500, ERROR_PAGE);
    }
  };
}
