// Frontend bridge for both RFC 8628 device authorization and authorization
// code + PKCE. The signed mcp_state selects a pending device or a pending
// PKCE request owned by aem-mcp. The frontend returns only to the fixed
// aem-mcp callback URI from the verified backend response.

import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Env } from '../config/env';
import { isValidRedirectUri } from './auth-codes';
import { getOAuthResourceBaseUrl } from './resource';

export const MCP_STATE_TTL_SECONDS = 5 * 60;

export interface McpStateClaims {
  deviceCode?: string;
  authRequestId?: string;
  mcpCallbackUri: string;
  redirectUri?: string;
  nonce: string;
  iat: number;
  exp: number;
}

type DeviceCodeLookup = (userCode: string) => { deviceCode: string } | null;

type RedirectOptions = {
  requireClientRedirectUri?: boolean;
};

export type McpStateBinding = {
  deviceCode?: string;
  authRequestId?: string;
  redirectUri?: string;
};

export function redirectToFrontendWithMcpState(
  env: Env,
  res: Response,
  binding: McpStateBinding,
  state?: string,
): void {
  const frontendBaseUrl = getFrontendBaseUrl(env);
  if (!frontendBaseUrl) {
    res.status(503).type('text/plain').send(
      'MCP_FRONTEND_URL is not configured on this server.',
    );
    return;
  }
  const hasDeviceCode = typeof binding.deviceCode === 'string' && binding.deviceCode.length > 0;
  const hasAuthRequestId = typeof binding.authRequestId === 'string' && binding.authRequestId.length > 0;
  if (hasDeviceCode === hasAuthRequestId) {
    res.status(400).type('text/plain').send('Invalid authorization request');
    return;
  }

  const nonce = randomBytes(16).toString('base64url');
  const mcpCallbackUri = `${getOAuthResourceBaseUrl(env.PUBLIC_URL, env.PORT)}/oauth/authorize/agent-callback`;
  const mcpState = jwt.sign(
    { ...binding, mcpCallbackUri, nonce },
    env.MCP_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: MCP_STATE_TTL_SECONDS },
  );
  const loginUrl = new URL(`${frontendBaseUrl.replace(/\/$/, '')}/user/login`);
  loginUrl.searchParams.set('mcp_state', mcpState);
  if (state) loginUrl.searchParams.set('state', state);
  res.redirect(302, loginUrl.toString());
}

/**
 * GET /oauth/authorize/redirect-to-frontend?user_code=…&redirect_uri=…&state=…
 *
 * Looks up the device_code by user_code, signs an mcp_state JWT, and
 * 302-redirects the user to aem-frontend's login page with that JWT
 * embedded as a query parameter.
 */
export function makeHandleRedirectToFrontend(
  env: Env,
  deviceCodeLookup: DeviceCodeLookup,
  options: RedirectOptions = {},
) {
  return function handleRedirectToFrontend(req: Request, res: Response): void {
    const userCodeRaw = req.query.user_code;
    const userCode =
      typeof userCodeRaw === 'string' ? userCodeRaw.trim().toUpperCase() : '';
    if (!userCode) {
      res.status(400).type('text/plain').send('user_code is required');
      return;
    }

    const row = deviceCodeLookup(userCode);
    if (!row) {
      res.status(400).type('text/plain').send('Invalid or expired user_code');
      return;
    }

    const redirectUriRaw = req.query.redirect_uri;
    const redirectUri = typeof redirectUriRaw === 'string' ? redirectUriRaw : '';
    const requireClientRedirectUri = options.requireClientRedirectUri !== false;
    if (
      (requireClientRedirectUri && !redirectUri) ||
      (redirectUri.length > 0 && !isValidRedirectUri(redirectUri))
    ) {
      resRedirectWithError(
        res,
        redirectUri,
        req.query.state,
        'invalid_request',
        'redirect_uri must be a loopback URL or allowed hosted-agent callback',
      );
      return;
    }

    const stateRaw = req.query.state;
    redirectToFrontendWithMcpState(
      env,
      res,
      { deviceCode: row.deviceCode, ...(redirectUri ? { redirectUri } : {}) },
      typeof stateRaw === 'string' ? stateRaw : undefined,
    );
  };
}

function getFrontendBaseUrl(env: Env): string | undefined {
  return env.MCP_FRONTEND_URL;
}

/**
 * Minimal port of `resRedirectWithError` (mirrors the helper in
 * `login-exchange-handler.ts`) for use here. On error we redirect
 * to the client with `?error=…&error_description=…&state=…`. Falls
 * back to a 400 HTML page if the redirect_uri is invalid.
 */
function resRedirectWithError(
  res: Response,
  redirectUri: unknown,
  state: unknown,
  errorCode: string,
  description: string,
): void {
  if (typeof redirectUri !== 'string' || !isValidRedirectUri(redirectUri)) {
    res.status(400).type('html').send(
      '<!doctype html><html><body><p>Invalid redirect_uri. Use a loopback URL or an allowed hosted-agent callback URL.</p></body></html>',
    );
    return;
  }
  const params = new URLSearchParams();
  params.set('error', errorCode);
  params.set('error_description', description);
  if (typeof state === 'string' && state.length > 0) {
    params.set('state', state);
  }
  res.redirect(302, `${redirectUri}?${params.toString()}`);
}
