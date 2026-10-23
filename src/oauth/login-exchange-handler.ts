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
//
// Session-reuse (Phase 5 follow-up): if the browser already holds an
// aem-backend session cookie, the GET handler attempts
// `exchangeBySession` before rendering the form. On success the
// device_code is auto-approved so the user does not need to re-enter
// credentials.

import { randomBytes } from 'node:crypto';
import express, { type Request, type Response, Router, type NextFunction } from 'express';

import {
  AemBackendOAuthError,
  type AemBackendOAuthClient,
} from '../clients/aem-backend-oauth-client';
import { OAuthError } from './errors';
import {
  makeHandleRedirectToFrontend,
  redirectToFrontendWithMcpState,
} from './frontend-login-handler';
import { makeHandleAgentBindCallback } from './agent-bind-callback';
import { DEFAULT_SCOPE } from './scopes';
import { getOAuthResourceBaseUrl, isSupportedOAuthResource } from './resource';
import type { DeviceCodesStore } from './device-codes';
import {
  type DeviceAuthorizationPageInput,
  type FormError,
  renderAuthorizationSuccessPage,
  renderDeviceAuthorizationPage,
} from './views/device-authorization-page';
import { ExchangeCodeError, verifyExchangeCode } from './exchange-code-verify';
import type { Env } from '../config/env';
import { BackendError } from '../errors/backend-error';
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

// In-memory store of pending authorization_code requests (PKCE flow).
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
  resource?: string;
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

// Derive the aem-backend base URL (e.g. http://localhost:3000) from the
// AEM_BACKEND_URL env var (e.g. http://localhost:3000/api) so that
// provider login links can be built correctly.
function getBackendBaseUrl(env: Env): string {
  const urlStr = env.AEM_BACKEND_URL;
  try {
    const url = new URL(urlStr);
    return `${url.protocol}//${url.host}`;
  } catch {
    return urlStr;
  }
}

// Optional aem-frontend base URL. When MCP_FRONTEND_URL is configured,
// the authorize page renders "Forgot Password" and "Sign Up" links that
// point at the frontend app. Undefined hides the links.
function getFrontendBaseUrl(env: Env): string | undefined {
  const value = env.MCP_FRONTEND_URL;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function renderForm(
  res: Response,
  userCode: string,
  opts: {
    error?: FormError;
    twoFactorRequired?: boolean;
    emailPrefill?: string;
    // When set, the form will carry the auth_code request context
    // through the POST in a hidden field, so the POST handler can
    // complete the auth_code + PKCE flow.
    authRequestId?: string;
    backendUrl?: string;
    frontendUrl?: string;
  } = {},
): void {
  const input: DeviceAuthorizationPageInput = {
    userCode,
    error: opts.error,
    twoFactorRequired: opts.twoFactorRequired,
    emailPrefill: opts.emailPrefill,
    authRequestId: opts.authRequestId,
    backendUrl: opts.backendUrl,
    frontendUrl: opts.frontendUrl,
  };
  // Conservative baseline headers for the OAuth form pages.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.status(200).type('html').send(renderDeviceAuthorizationPage(input));
}

// RFC 6749 §4.1.2.1: on auth_code errors where redirect_uri is valid,
// redirect back to the client with ?error=...&state=...&error_description=...
function resRedirectWithError(
  res: Response,
  redirectUri: unknown,
  state: unknown,
  error: string,
  description: string,
  publicUrl: string | undefined,
  port: number,
): void {
  if (typeof redirectUri !== 'string' || !isValidRedirectUri(redirectUri)) {
    res.status(400).type('html').send(
      `<!doctype html><html><body><p>OAuth error: ${error} — ${description}</p></body></html>`,
    );
    return;
  }
  const params = new URLSearchParams({ error, error_description: description });
  if (typeof state === 'string' && state.length > 0) params.set('state', state);
  params.set('iss', getOAuthResourceBaseUrl(publicUrl, port));
  res.redirect(302, `${redirectUri}?${params.toString()}`);
}

export function createLoginExchangeRouter(deps: LoginExchangeDeps): Router {
  const router = Router();
  const lookupDeviceCode = (userCode: string) => {
    const row = deps.deviceCodes.getByUserCode(userCode);
    return row ? { deviceCode: row.deviceCode } : null;
  };
  const handleRedirectToFrontend = makeHandleRedirectToFrontend(
    deps.env,
    lookupDeviceCode,
  );
  const handleDeviceRedirectToFrontend = makeHandleRedirectToFrontend(
    deps.env,
    lookupDeviceCode,
    { requireClientRedirectUri: false },
  );

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

  // Extract the existing GET handler body so we can call it as a fallback
  // when session-reuse does not apply.
  function handleGetAuthorize(req: Request, res: Response): void {
    // Derive the backend base URL so provider buttons are rendered as
    // active links (rather than disabled placeholders).
    const backendUrl = getBackendBaseUrl(deps.env);
    // Derive the optional aem-frontend base URL so the page can link to
    // Forgot Password / Sign Up on the Journaler web app.
    const frontendUrl = getFrontendBaseUrl(deps.env);

    // ---- Authorization Code + PKCE path ----
    if (
      typeof req.query.response_type === 'string' &&
      req.query.response_type !== 'device_code'
    ) {
      const responseType = req.query.response_type;
      if (responseType !== 'code') {
        resRedirectWithError(
          res,
          req.query.redirect_uri,
          req.query.state,
          'unsupported_response_type',
          `response_type must be 'code' (got '${responseType}')`,
          deps.env.PUBLIC_URL,
          deps.env.PORT,
        );
        return;
      }
      const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
      const redirectUri =
        typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const codeChallenge =
        typeof req.query.code_challenge === 'string' ? req.query.code_challenge : '';
      const codeChallengeMethod =
        typeof req.query.code_challenge_method === 'string' ? req.query.code_challenge_method : '';
      const scope =
        typeof req.query.scope === 'string' ? req.query.scope : DEFAULT_SCOPE;
      const resource =
        typeof req.query.resource === 'string' ? req.query.resource : undefined;
      const expectedResource = getOAuthResourceBaseUrl(deps.env.PUBLIC_URL, deps.env.PORT);

      if (!clientId) {
        resRedirectWithError(
          res,
          redirectUri,
          state,
          'invalid_request',
          'client_id is required',
          deps.env.PUBLIC_URL,
          deps.env.PORT,
        );
        return;
      }
      if (resource !== undefined && !isSupportedOAuthResource(resource, expectedResource)) {
        resRedirectWithError(
          res,
          redirectUri,
          state,
          'invalid_target',
          'resource does not identify this MCP server',
          deps.env.PUBLIC_URL,
          deps.env.PORT,
        );
        return;
      }
      if (!redirectUri || !isValidRedirectUri(redirectUri)) {
        // redirect_uri itself is invalid: cannot redirect; render an
        // error page instead. (RFC 6749 §4.1.2.1)
        res.status(400).type('html').send(
          '<!doctype html><html><body><p>Invalid redirect_uri. Use a loopback URL or an allowed hosted-agent callback URL.</p></body></html>',
        );
        return;
      }
      if (!codeChallenge) {
        resRedirectWithError(
          res,
          redirectUri,
          state,
          'invalid_request',
          'code_challenge is required',
          deps.env.PUBLIC_URL,
          deps.env.PORT,
        );
        return;
      }
      if (codeChallengeMethod !== 'S256') {
        resRedirectWithError(
          res,
          redirectUri,
          state,
          'invalid_request',
          `code_challenge_method must be 'S256' (got '${codeChallengeMethod}')`,
          deps.env.PUBLIC_URL,
          deps.env.PORT,
        );
        return;
      }

      const authRequestId = createPendingAuthRequest({
        clientId,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod,
        scope,
        resource,
      });

      if (req.query.bridge !== '0') {
        redirectToFrontendWithMcpState(deps.env, res, { authRequestId });
        return;
      }

      // We piggy-back on the device-flow form (it already collects
      // email + password + totp). The hidden authRequestId field tells
      // the POST handler this is the auth_code flow.
      renderForm(res, '', { authRequestId, backendUrl, frontendUrl });
      return;
    }

    // ---- Device flow path (legacy) ----
    const userCodeRaw =
      req.query.user_code ?? req.query['user-code'] ?? req.query.code;
    const userCode =
      typeof userCodeRaw === 'string' ? userCodeRaw.trim().toUpperCase() : '';
    if (!isValidUserCode(userCode)) {
      renderForm(res, '', { error: { kind: 'deviceCodeInvalid' }, backendUrl, frontendUrl });
      return;
    }
    const row = deps.deviceCodes.getByUserCode(userCode);
    if (!row) {
      renderForm(res, '', {
        error: { kind: 'deviceCodeExpired' },
        backendUrl,
        frontendUrl,
      });
      return;
    }
    if (row.status === 'approved') {
      res.status(200).type('html').send(renderAuthorizationSuccessPage(userCode));
      return;
    }
    if (row.status === 'denied') {
      res.status(200).type('html').send(
        '<!doctype html><html><body><p>This code was denied. Restart your agent to issue a new one.</p></body></html>',
      );
      return;
    }
    if (req.query.bridge !== '0') {
      req.query = { ...req.query, user_code: userCode };
      handleDeviceRedirectToFrontend(req, res);
      return;
    }
    renderForm(res, userCode, { backendUrl, frontendUrl });
  }

  // ---- GET /authorize and /oauth/authorize ----
  // Session-reuse wrapper: attempt exchangeBySession first; if that
  // succeeds we can auto-approve without rendering the form.
  //
  // Two request shapes are supported on the same endpoint:
  //
  //   1) Device flow (legacy Claude Code, etc.):
  //        /oauth/authorize?user_code=XXXX-XXXX
  //      Renders the form; on POST we approve the device_code so the
  //      agent's /oauth/token polling can exchange it.
  //
  //   2) Authorization Code + PKCE (Cursor, Gemini CLI, ChatGPT, Codex, etc.):
  //        /oauth/authorize?response_type=code
  //                       &client_id=...&redirect_uri=...&state=...
  //                       &code_challenge=...&code_challenge_method=S256
  //      Stores the request in pendingAuthRequests and redirects the user
  //      to aem-frontend by default. Its callback mints a one-shot auth code
  //      and 302-redirects to redirect_uri?code=...&state=..., where the agent's
  //      /oauth/token call (with grant_type=authorization_code and
  //      code_verifier) exchanges it for an MCP access token.
  router.get(
    ['/authorize', '/oauth/authorize'],
    gateEnabled,
    async (req: Request, res: Response): Promise<void> => {
      // Attempt session-reuse: if the browser sends a session cookie from
      // the Journaler app, exchange it directly for an exchangeCode so the
      // user does not need to re-enter credentials.
      // Authorization-code + PKCE must first create an MCP-owned pending
      // request, then use the frontend bridge so its callback can mint the
      // final code against the stored PKCE challenge.
      if (req.query.response_type === 'code') {
        handleGetAuthorize(req, res);
        return;
      }
      const cookieHeader =
        typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
      const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);

      if (tokenMatch !== null) {
        const sessionCookie = `token=${tokenMatch[1]}`;
        try {
          const { exchangeCode } =
            await deps.aemBackendOAuth.exchangeBySession(sessionCookie);

          // Verify the code locally before acting on it.
          const verified = verifyExchangeCode(exchangeCode, deps.env);

          // ---- Device flow ----
          const userCodeRaw =
            req.query.user_code ?? req.query['user-code'] ?? req.query.code;
          const userCode =
            typeof userCodeRaw === 'string'
              ? userCodeRaw.trim().toUpperCase()
              : '';

          if (isValidUserCode(userCode)) {
            const row = deps.deviceCodes.getByUserCode(userCode);
            if (row) {
              if (row.status === 'approved') {
                res.setHeader(
                  'Content-Security-Policy',
                  "default-src 'none'; style-src 'unsafe-inline'",
                );
                res
                  .status(200)
                  .type('html')
                  .send(renderAuthorizationSuccessPage(userCode));
                return;
              }
              if (row.status === 'pending') {
                deps.deviceCodes.approve(
                  row.deviceCode,
                  verified.userId,
                  verified.jti,
                );
                audit.deviceApproved({
                  userCode,
                  userId: verified.userId,
                  jti: verified.jti,
                  clientId: row.clientId,
                });
                res.setHeader(
                  'Content-Security-Policy',
                  "default-src 'none'; style-src 'unsafe-inline'",
                );
                res
                  .status(200)
                  .type('html')
                  .send(renderAuthorizationSuccessPage(userCode));
                return;
              }
            }
          }

          // exchangeBySession succeeded but there was no pending
          // device_code or auth_request_id to approve.
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; style-src 'unsafe-inline'",
          );
          res.status(200).type('html').send(
            '<!doctype html><html><body><p>Session recognized but no pending authorization request found. Please restart your agent.</p></body></html>',
          );
          return;
        } catch (error) {
          // exchangeBySession threw (missing session, invalid/expired
          // cookie, backend unreachable). Fall through to the normal
          // form-rendering path so the user can log in with email/password.
          if (
            error instanceof AemBackendOAuthError ||
            error instanceof ExchangeCodeError ||
            error instanceof BackendError
          ) {
            // session is not usable — fall through to form
          } else {
            // Unexpected error; still fall through rather than breaking
            // the authorization page.
            console.error(
              '[session-reuse] unexpected error during exchangeBySession',
              error,
            );
          }
        }
      }

      // No session cookie or session-reuse failed — delegate to the normal
      // GET handler which renders the email/password form.
      handleGetAuthorize(req, res);
    },
  );

  // ---- POST /authorize and /oauth/authorize (form submission) ----
  router.post(
    ['/authorize', '/oauth/authorize'],
    gateEnabled,
    express.urlencoded({ extended: false, limit: '4kb' }),
    async (req: Request, res: Response): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const totpCode =
        typeof body.totp === 'string' ? body.totp.trim() : undefined;

      // Branch on which flow this POST belongs to.
      const authRequestId =
        typeof body.authRequestId === 'string' ? body.authRequestId : '';

      // Derive the backend base URL for provider button rendering and
      // the optional frontend base URL for Forgot / Sign Up links.
      const backendUrl = getBackendBaseUrl(deps.env);
      const frontendUrl = getFrontendBaseUrl(deps.env);

      // ---- AUTH_CODE + PKCE flow ----
      if (authRequestId) {
        const pending = consumePendingAuthRequest(authRequestId);
        if (!pending) {
          res.status(400).type('html').send(
            '<!doctype html><html><body><p>This authorization request has expired or was already used. Please restart your agent.</p></body></html>',
          );
          return;
        }
        if (!isValidEmail(email) || password.length === 0) {
          renderForm(res, '', {
            authRequestId,
            error: { kind: 'invalidInput' },
            backendUrl,
            frontendUrl,
          });
          return;
        }

        // 1) Authenticate against aem-backend.
        let exchangeCode: string;
        try {
          const result = await deps.aemBackendOAuth.exchange({
            email,
            password,
            totpCode,
          });
          exchangeCode = result.exchangeCode;
          audit.exchangeReceived({
            userCode: `authcode:${pending.clientId.slice(0, 12)}`,
            reason: 'ok',
          });
        } catch (error) {
          if (error instanceof AemBackendOAuthError) {
            if (error.code === 'twoFactorRequired') {
              renderForm(res, '', {
                authRequestId,
                twoFactorRequired: true,
                emailPrefill: email,
                error: { kind: 'twoFactorRequired' },
                backendUrl,
                frontendUrl,
              });
              return;
            }
            renderForm(res, '', {
              authRequestId,
              error: { kind: 'invalidCredentials' },
              emailPrefill: email,
              backendUrl,
              frontendUrl,
            });
            return;
          }
          renderForm(res, '', {
            authRequestId,
            error: { kind: 'backendUnavailable' },
            backendUrl,
            frontendUrl,
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
              error: { kind: 'exchangeCodeInvalid' },
              backendUrl,
              frontendUrl,
            });
            return;
          }
          renderForm(res, '', {
            authRequestId,
            error: { kind: 'backendUnavailable' },
            backendUrl,
            frontendUrl,
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
          resource: pending.resource,
          codeChallenge: pending.codeChallenge,
          codeChallengeMethod: pending.codeChallengeMethod,
          expiresAt: new Date(
            Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
          ).toISOString(),
          consumed: false,
        });
        audit.deviceApproved({
          userCode: `authcode:${pending.clientId.slice(0, 12)}`,
          userId: verified.userId,
          jti: verified.jti,
          clientId: pending.clientId,
        });

        // 4) 302 redirect to redirect_uri?code=...&state=...
        const params = new URLSearchParams({
          code,
          iss: getOAuthResourceBaseUrl(deps.env.PUBLIC_URL, deps.env.PORT),
        });
        if (pending.state.length > 0) params.set('state', pending.state);
        res.redirect(302, `${pending.redirectUri}?${params.toString()}`);
        return;
      }

      // ---- DEVICE flow (legacy) ----
      const userCodeRawValue = body.user_code ?? body['user-code'];
      const userCodeRaw =
        typeof userCodeRawValue === 'string'
          ? userCodeRawValue.trim().toUpperCase()
          : '';

      if (!isValidUserCode(userCodeRaw)) {
        renderForm(res, '', { error: { kind: 'deviceCodeInvalid' }, backendUrl, frontendUrl });
        return;
      }
      if (!isValidEmail(email) || password.length === 0) {
        renderForm(res, userCodeRaw, { error: { kind: 'invalidInput' }, backendUrl, frontendUrl });
        return;
      }

      const row = deps.deviceCodes.getByUserCode(userCodeRaw);
      if (!row) {
        renderForm(res, '', {
          error: { kind: 'deviceCodeExpired' },
          backendUrl,
          frontendUrl,
        });
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
              error: { kind: 'twoFactorRequired' },
              backendUrl,
              frontendUrl,
            });
            return;
          }
          renderForm(res, userCodeRaw, {
            error: { kind: 'invalidCredentials' },
            emailPrefill: email,
            backendUrl,
            frontendUrl,
          });
          return;
        }
        renderForm(res, userCodeRaw, {
          error: { kind: 'backendUnavailable' },
          backendUrl,
          frontendUrl,
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
            error: { kind: 'exchangeCodeInvalid' },
            backendUrl,
            frontendUrl,
          });
          return;
        }
        renderForm(res, userCodeRaw, {
          error: { kind: 'backendUnavailable' },
          backendUrl,
          frontendUrl,
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
          res.status(400).type('html').send(
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

  // ---- GET /oauth/authorize/redirect-to-frontend ----
  // Phase 6 bridge: when MCP_FRONTEND_URL is configured, a user can
  // choose to log in via the real aem-frontend app instead of the
  // in-page form. We sign an mcp_state JWT, then 302 to the frontend
  // login page.
  router.get('/oauth/authorize/redirect-to-frontend', gateEnabled, handleRedirectToFrontend);

  router.get(
    '/oauth/authorize/agent-callback',
    gateEnabled,
    makeHandleAgentBindCallback({
      env: deps.env,
      deviceCodes: deps.deviceCodes,
      authCodes: deps.authCodes,
      consumeAuthRequest: consumePendingAuthRequest,
    }),
  );

  return router;
}
