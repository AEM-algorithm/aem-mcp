// GET /oauth/authorize and POST /oauth/authorize — login exchange handler.
//
// Phase 4. The user lands here from their agent's "paste this code at
// <verificationUri>" prompt. The form collects email/password (+ optional
// TOTP), POSTs to aem-backend, gets back a short-lived `exchangeCode` JWT,
// verifies it locally, and binds the verified userId to the device_code
// (via `deviceCodes.approve(...)`).
//
// On success the device_code's status flips to `approved`; the agent's
// `POST /oauth/token` polling will then return a fresh MCP access token.

import express, { type Request, type Response, Router, type NextFunction } from 'express';

import {
  AemBackendOAuthError,
  type AemBackendOAuthClient,
} from '../clients/aem-backend-oauth-client';
import { OAuthError } from './errors';
import type { DeviceCodesStore } from './device-codes';
import {
  type DeviceAuthorizationPageInput,
  renderAuthorizationSuccessPage,
  renderDeviceAuthorizationPage,
} from './views/device-authorization-page';
import { ExchangeCodeError, verifyExchangeCode } from './exchange-code-verify';
import type { Env } from '../config/env';

export type LoginExchangeDeps = {
  aemBackendOAuth: AemBackendOAuthClient;
  deviceCodes: DeviceCodesStore;
  env: Env;
  oauthEnabled: boolean;
};

function isValidUserCode(s: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(s);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

function renderForm(
  res: Response,
  userCode: string,
  opts: { error?: string; twoFactorRequired?: boolean; emailPrefill?: string } = {},
): void {
  const input: DeviceAuthorizationPageInput = {
    userCode,
    error: opts.error,
    twoFactorRequired: opts.twoFactorRequired,
    emailPrefill: opts.emailPrefill,
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

  // ---- GET /oauth/authorize?user_code=XXXX-XXXX ----
  router.get('/oauth/authorize', gateEnabled, (req: Request, res: Response): void => {
    const userCodeRaw = req.query.user_code;
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

  // ---- POST /oauth/authorize (form submission) ----
  router.post(
    '/oauth/authorize',
    gateEnabled,
    express.urlencoded({ extended: false, limit: '4kb' }),
    async (req: Request, res: Response): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const userCodeRaw =
        typeof body.user_code === 'string' ? body.user_code.trim().toUpperCase() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const totpCode = typeof body.totp === 'string' ? body.totp.trim() : undefined;

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
      let twoFactorPending = false;
      try {
        const result = await deps.aemBackendOAuth.exchange({
          email,
          password,
          totpCode,
        });
        exchangeCode = result.exchangeCode;
      } catch (error) {
        if (error instanceof AemBackendOAuthError) {
          if (error.code === 'twoFactorRequired') {
            twoFactorPending = true;
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
