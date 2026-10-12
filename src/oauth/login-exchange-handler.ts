// GET/POST authorization handler. Both the root OAuth paths used by Cursor
// and the existing /oauth-prefixed paths are supported.
//
// Phase 4. The user lands here from their agent's "paste this code at
// <verificationUri>" prompt. The form collects email/password (+ optional
// TOTP), POSTs to aem-backend, gets back a short-lived `exchangeCode` JWT,
// verifies it locally, and binds the verified userId to the device_code
// (via `deviceCodes.approve(...)`).
//
// On success the device_code's status flips to `approved`; the agent's
// `POST /oauth/token` polling will then return a fresh MCP access token.

import { randomBytes } from 'node:crypto';
import express, { type Request, type Response, Router, type NextFunction } from 'express';

import {
  AemBackendOAuthError,
  type AemBackendOAuthClient,
} from '../clients/aem-backend-oauth-client';
import { OAuthError } from './errors';
import { DEFAULT_SCOPE } from './scopes';
import type { DeviceCodesStore } from './device-codes';
import {
  type DeviceAuthorizationPageInput,
  renderAuthorizationSuccessPage,
  renderDeviceAuthorizationPage,
} from './views/device-authorization-page';
import { ExchangeCodeError, verifyExchangeCode } from './exchange-code-verify';
import type { Env } from '../config/env';
import { audit } from '../utils/audit';
import {
  AUTH_CODE_TTL_SECONDS,
  type AuthCodesStore,
  generateAuthorizationCode,
  isValidRedirectUri,
} from './auth-codes';

export type LoginExchangeDeps = {
  aemBackendOAuth: AemBackendOAuthClient;
  deviceCodes: DeviceCodesStore;
  authCodes: AuthCodesStore;
  env: Env;
  oauthEnabled: boolean;
};

function isValidUserCode(s: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(s);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

// In-memory store of pending authorization_code requests (Cursor flow).
// Key = authRequestId (random); value = the request params we need to
// thread through the form POST and then redirect to the client's
// redirect_uri with ?code=...&state=... after successful login.
type PendingAuthRequest = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'plain' | 'S256';
  scope: string;
  expiresAt: number; // epoch ms
};
const pendingAuthRequests = new Map<string, PendingAuthRequest>();

function createPendingAuthRequest(input: Omit<PendingAuthRequest, 'expiresAt'>): string {
  // Lazy GC.
  const now = Date.now();
  for (const [k, v] of pendingAuthRequests) {
    if (v.expiresAt <= now) pendingAuthRequests.delete(k);
  }
  const id = randomBytes(16).toString('hex');
  pendingAuthRequests.set(id, { ...input, expiresAt: now + 5 * 60_000 });
  return id;
}

function consumePendingAuthRequest(id: string): PendingAuthRequest | undefined {
  const row = pendingAuthRequests.get(id);
  if (!row) return undefined;
  pendingAuthRequests.delete(id); // one-shot
  if (row.expiresAt <= Date.now()) return undefined;
  return row;
}

function renderForm(
  res: Response,
  userCode: string,
  opts: {
    error?: string;
    twoFactorRequired?: boolean;
    emailPrefill?: string;
    // When set, the form will carry the auth_code request context
    // through the POST in a hidden field, so the POST handler can
    // complete the auth_code + PKCE flow (Cursor).
    authRequestId?: string;
  } = {},
): void {
  const input: DeviceAuthorizationPageInput = {
    userCode,
    error: opts.error,
    twoFactorRequired: opts.twoFactorRequired,
    emailPrefill: opts.emailPrefill,
    authRequestId: opts.authRequestId,
  };
  // Conservative baseline headers for the OAuth form pages.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.status(200).type('html').send(renderDeviceAuthorizationPage(input));
}

export function createLoginExchangeRouter(deps: LoginExchangeDeps): Router {
  const router = Router();

  function gateEnabled(_req: Request, res: Response, next: NextFunction): void {
    if (!deps.oauthEnabled) {
      res
        .status(503)
        .type('html')
        .send(
          '<!doctype html><html><body><p>OAuth is currently disabled. Please try again later.</p></body></html>',
        );
      return;
    }
    next();
  }

  // ---- GET /authorize and /oauth/authorize ----
  // Two request shapes are supported on the same endpoint:
  //
  //   1) Device flow (legacy Claude Code, etc.):
  //        /oauth/authorize?user_code=XXXX-XXXX
  //      Renders the form; on POST we approve the device_code so the
  //      agent's /oauth/token polling can exchange it.
  //
  //   2) Authorization Code + PKCE (Cursor, etc.):
  //        /oauth/authorize?response_type=code
  //                       &client_id=...&redirect_uri=...&state=...
  //                       &code_challenge=...&code_challenge_method=S256
  //      Stores the request in pendingAuthRequests and renders the
  //      form. On POST we mint a one-shot auth code and 302-redirect
  //      to redirect_uri?code=...&state=..., where the agent's
  //      /oauth/token call (with grant_type=authorization_code and
  //      code_verifier) exchanges it for an MCP access token.
  router.get(['/authorize', '/oauth/authorize'], gateEnabled, (req: Request, res: Response): void => {
    // ---- Authorization Code + PKCE path (Cursor) ----
    if (typeof req.query.response_type === 'string') {
      const responseType = req.query.response_type;
      if (responseType !== 'code') {
        resRedirectWithError(res, req.query.redirect_uri, req.query.state,
          'unsupported_response_type',
          `response_type must be 'code' (got '${responseType}')`);
        return;
      }
      const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
      const redirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const codeChallenge = typeof req.query.code_challenge === 'string' ? req.query.code_challenge : '';
      const codeChallengeMethod = typeof req.query.code_challenge_method === 'string'
        ? req.query.code_challenge_method
        : 'plain';
      const scope = typeof req.query.scope === 'string' ? req.query.scope : DEFAULT_SCOPE;

      if (!clientId) {
        resRedirectWithError(res, redirectUri, state, 'invalid_request', 'client_id is required');
        return;
      }
      if (!redirectUri || !isValidRedirectUri(redirectUri)) {
        // redirect_uri itself is invalid: cannot redirect; render an
        // error page instead. (RFC 6749 §4.1.2.1)
        res
          .status(400)
          .type('html')
          .send(
            '<!doctype html><html><body><p>Invalid redirect_uri. Only loopback http URLs (localhost / 127.0.0.1) are accepted.</p></body></html>',
          );
        return;
      }
      if (!codeChallenge) {
        resRedirectWithError(res, redirectUri, state, 'invalid_request', 'code_challenge is required');
        return;
      }
      if (codeChallengeMethod !== 'plain' && codeChallengeMethod !== 'S256') {
        resRedirectWithError(res, redirectUri, state, 'invalid_request',
          `code_challenge_method must be 'plain' or 'S256' (got '${codeChallengeMethod}')`);
        return;
      }

      const authRequestId = createPendingAuthRequest({
        clientId, redirectUri, state, codeChallenge,
        codeChallengeMethod,
        scope,
      });

      // We piggy-back on the device-flow form (it already collects
      // email + password + totp). The hidden authRequestId field tells
      // the POST handler this is the auth_code flow.
      renderForm(res, '', { authRequestId });
      return;
    }

    // ---- Device flow path (legacy) ----
    const userCodeRaw =
      req.query.user_code ?? req.query['user-code'] ?? req.query.code;
    const userCode = typeof userCodeRaw === 'string' ? userCodeRaw.trim().toUpperCase() : '';
    if (!isValidUserCode(userCode)) {
      res
        .status(400)
        .type('html')
        .send(
          '<!doctype html><html><body><p>Invalid or missing device code. Restart your agent and try again.</p></body></html>',
        );
      return;
    }
    const row = deps.deviceCodes.getByUserCode(userCode);
    if (!row) {
      res
        .status(404)
        .type('html')
        .send(
          '<!doctype html><html><body><p>This code has expired or was never issued. Restart your agent and try again.</p></body></html>',
        );
      return;
    }
    if (row.status === 'approved') {
      res
        .status(200)
        .type('html')
        .send(renderAuthorizationSuccessPage(userCode));
      return;
    }
    if (row.status === 'denied') {
      res
        .status(200)
        .type('html')
        .send(
          '<!doctype html><html><body><p>This code was denied. Restart your agent to issue a new one.</p></body></html>',
        );
      return;
    }
    renderForm(res, userCode);
  });

  // RFC 6749 §4.1.2.1: on auth_code errors where redirect_uri is valid,
  // redirect back to the client with ?error=...&state=...&error_description=...
  function resRedirectWithError(
    res: Response,
    redirectUri: unknown,
    state: unknown,
    error: string,
    description: string,
  ): void {
    if (typeof redirectUri !== 'string' || !isValidRedirectUri(redirectUri)) {
      res.status(400).type('html').send(
        `<!doctype html><html><body><p>OAuth error: ${error} — ${description}</p></body></html>`,
      );
      return;
    }
    const params = new URLSearchParams({ error, error_description: description });
    if (typeof state === 'string' && state.length > 0) params.set('state', state);
    res.redirect(302, `${redirectUri}?${params.toString()}`);
  }

  // ---- POST /authorize and /oauth/authorize (form submission) ----
  router.post(
    ['/authorize', '/oauth/authorize'],
    gateEnabled,
    express.urlencoded({ extended: false, limit: '4kb' }),
    async (req: Request, res: Response): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const totpCode = typeof body.totp === 'string' ? body.totp.trim() : undefined;

      // Branch on which flow this POST belongs to.
      const authRequestId =
        typeof body.authRequestId === 'string' ? body.authRequestId : '';

      // ---- AUTH_CODE + PKCE flow (Cursor) ----
      if (authRequestId) {
        const pending = consumePendingAuthRequest(authRequestId);
        if (!pending) {
          res
            .status(400)
            .type('html')
            .send(
              '<!doctype html><html><body><p>This authorization request has expired or was already used. Please restart your agent.</p></body></html>',
            );
          return;
        }
        if (!isValidEmail(email) || password.length === 0) {
          renderForm(res, '', {
            authRequestId,
            error: 'Enter a valid email and password.',
          });
          return;
        }

        // 1) Authenticate against aem-backend.
        let exchangeCode: string;
        try {
          const result = await deps.aemBackendOAuth.exchange({ email, password, totpCode });
          exchangeCode = result.exchangeCode;
          audit.exchangeReceived({ userCode: `authcode:${pending.clientId.slice(0, 12)}`, reason: 'ok' });
        } catch (error) {
          if (error instanceof AemBackendOAuthError) {
            if (error.code === 'twoFactorRequired') {
              renderForm(res, '', {
                authRequestId,
                twoFactorRequired: true,
                emailPrefill: email,
                error: 'Enter your authenticator code.',
              });
              return;
            }
            renderForm(res, '', {
              authRequestId,
              error: 'Invalid email or password.',
              emailPrefill: email,
            });
            return;
          }
          renderForm(res, '', {
            authRequestId,
            error: 'Authentication service is unavailable. Please try again shortly.',
          });
          return;
        }

        // 2) Verify the exchangeCode locally.
        let verified;
        try {
          verified = verifyExchangeCode(exchangeCode, deps.env);
        } catch (error) {
          if (error instanceof ExchangeCodeError) {
            renderForm(res, '', {
              authRequestId,
              error: 'Authentication service returned an invalid code. Please try again.',
            });
            return;
          }
          renderForm(res, '', {
            authRequestId,
            error: 'Authentication service is unavailable. Please try again shortly.',
          });
          return;
        }

        // 3) Mint a one-shot authorization code bound to PKCE params.
        const code = generateAuthorizationCode();
        deps.authCodes.insert({
          code,
          userId: verified.userId,
          jti: verified.jti,
          clientId: pending.clientId,
          redirectUri: pending.redirectUri,
          scope: pending.scope,
          codeChallenge: pending.codeChallenge,
          codeChallengeMethod: pending.codeChallengeMethod,
          expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
          consumed: false,
        });
        audit.deviceApproved({
          userCode: `authcode:${pending.clientId.slice(0, 12)}`,
          userId: verified.userId,
          jti: verified.jti,
          clientId: pending.clientId,
        });

        // 4) 302 redirect to redirect_uri?code=...&state=...
        const params = new URLSearchParams({ code });
        if (pending.state.length > 0) params.set('state', pending.state);
        res.redirect(302, `${pending.redirectUri}?${params.toString()}`);
        return;
      }

      // ---- DEVICE flow (legacy) ----
      const userCodeRawValue = body.user_code ?? body['user-code'];
      const userCodeRaw =
        typeof userCodeRawValue === 'string' ? userCodeRawValue.trim().toUpperCase() : '';

      if (!isValidUserCode(userCodeRaw)) {
        res
          .status(400)
          .type('html')
          .send(
            '<!doctype html><html><body><p>Invalid device code. Restart your agent and try again.</p></body></html>',
          );
          return;
      }
      if (!isValidEmail(email) || password.length === 0) {
        renderForm(res, userCodeRaw, { error: 'Enter a valid email and password.' });
        return;
      }

      const row = deps.deviceCodes.getByUserCode(userCodeRaw);
      if (!row) {
        res
          .status(404)
          .type('html')
          .send(
            '<!doctype html><html><body><p>This code has expired. Restart your agent and try again.</p></body></html>',
          );
        return;
      }
      if (row.status !== 'pending') {
        res
          .status(200)
          .type('html')
          .send(renderAuthorizationSuccessPage(userCodeRaw));
        return;
      }

      // 1) Call aem-backend to exchange credentials for an exchangeCode JWT.
      let exchangeCode: string;
      try {
        const result = await deps.aemBackendOAuth.exchange({
          email,
          password,
          totpCode,
        });
        exchangeCode = result.exchangeCode;
        audit.exchangeReceived({ userCode: userCodeRaw, reason: 'ok' });
      } catch (error) {
        if (error instanceof AemBackendOAuthError) {
          if (error.code === 'twoFactorRequired') {
            renderForm(res, userCodeRaw, {
              twoFactorRequired: true,
              emailPrefill: email,
              error: 'Enter your authenticator code.',
            });
            return;
          }
          renderForm(res, userCodeRaw, {
            error: 'Invalid email or password.',
            emailPrefill: email,
          });
          return;
        }
        renderForm(res, userCodeRaw, {
          error: 'Authentication service is unavailable. Please try again shortly.',
        });
        return;
      }

      // 2) Verify the exchangeCode locally.
      let verified;
      try {
        verified = verifyExchangeCode(exchangeCode, deps.env);
      } catch (error) {
        if (error instanceof ExchangeCodeError) {
          renderForm(res, userCodeRaw, {
            error: 'Authentication service returned an invalid code. Please try again.',
          });
          return;
        }
        renderForm(res, userCodeRaw, {
          error: 'Authentication service is unavailable. Please try again shortly.',
        });
        return;
      }

      // 3) Bind verified userId to the device_code (status -> approved).
      try {
        deps.deviceCodes.approve(row.deviceCode, verified.userId, verified.jti);
        audit.deviceApproved({
          userCode: userCodeRaw,
          userId: verified.userId,
          jti: verified.jti,
          clientId: row.clientId,
        });
      } catch (error) {
        if (error instanceof OAuthError) {
          res
            .status(400)
            .type('html')
            .send(
              `<!doctype html><html><body><p>Cannot authorize code: ${error.message}</p></body></html>`,
            );
          return;
        }
        throw error;
      }

      res
        .status(200)
        .type('html')
        .send(renderAuthorizationSuccessPage(userCodeRaw));
    },
  );

  return router;
}
