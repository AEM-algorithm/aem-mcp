// aem-backend OAuth exchange client.
//
// Phase 4. Calls aem-backend's `POST /api/oauth/exchange` with
// `{ email, password, totpCode? }` and returns the parsed response
// (or throws a typed error). The response carries a short-lived JWT
// (HS256, 60s TTL) that aem-mcp verifies locally with the shared
// `MCP_OAUTH_SIGNING_KEY`.
//
// Contract (see `agent-os/specs/2026-10-08-2353-dev-4154-aem-mcp-external-agent-auth/references.md`):
// - 200: `{ exchangeCode: <jwt>, userId: <number> }`
// - 401: `{ error: "invalidCredentials" }`
// - 401: `{ error: "twoFactorRequired" }` (TOTP required)
//
// Errors thrown:
// - `AemBackendOAuthError` — typed, carries the backend's `error` code
//   (e.g. `invalidCredentials`, `twoFactorRequired`) plus status.
// - Falls through other errors as `BackendError` from the existing client.

import axios, { type AxiosInstance } from 'axios';

import type { Env } from '../config/env';
import { BackendError } from '../errors/backend-error';

export const AemBackendOAuthErrorCode = {
  InvalidCredentials: 'invalidCredentials',
  TwoFactorRequired: 'twoFactorRequired',
  MissingSession: 'missingSession',
  InvalidSession: 'invalidSession',
} as const;

export type AemBackendOAuthErrorCode =
  (typeof AemBackendOAuthErrorCode)[keyof typeof AemBackendOAuthErrorCode];

export class AemBackendOAuthError extends Error {
  public readonly status: number;
  public readonly code: AemBackendOAuthErrorCode;

  constructor(code: AemBackendOAuthErrorCode, message: string, status: number) {
    super(message);
    this.name = 'AemBackendOAuthError';
    this.code = code;
    this.status = status;
  }
}

export type ExchangeRequest = {
  email: string;
  password: string;
  totpCode?: string;
};

export type ExchangeResponse = {
  // HS256 JWT, aud='aem-mcp', sub=<userId>, jti, 60s TTL. The userId is
  // recovered from the JWT 'sub' claim by verifyExchangeCode, not from
  // the response body.
  exchangeCode: string;
};

export type AemBackendOAuthClient = {
  exchange: (req: ExchangeRequest) => Promise<ExchangeResponse>;
  /**
   * Exchange an existing aem-backend session cookie directly for an
   * exchangeCode, bypassing email/password login. Used by the GET
   * /oauth/authorize handler to auto-approve when the browser already
   * holds a Journaler session cookie.
   *
   * @param cookieHeader  Full `Cookie` header value, e.g. `token=abc123`
   * @returns             Promise resolving to { exchangeCode }
   * @throws AemBackendOAuthError with code `missingSession`  — no session cookie present
   * @throws AemBackendOAuthError with code `invalidSession`  — cookie invalid or expired
   * @throws BackendError                                             — backend unreachable or 429
   */
  exchangeBySession: (cookieHeader: string) => Promise<ExchangeResponse>;
};

export function createAemBackendOAuthClient(env: Env): AemBackendOAuthClient {
  const http: AxiosInstance = axios.create({
    baseURL: env.MCP_BACKEND_OAUTH_EXCHANGE_URL,
    timeout: 15_000,
  });

  // Separate client for session-exchange so baseURL is independent.
  const bySessionHttp: AxiosInstance = axios.create({
    baseURL: env.MCP_BACKEND_OAUTH_EXCHANGE_BY_SESSION_URL,
    timeout: 15_000,
  });

  return {
    async exchange(req: ExchangeRequest): Promise<ExchangeResponse> {
      try {
        const response = await http.post('', req, {
          validateStatus: () => true,
          headers: { 'content-type': 'application/json' },
        });

        // aem-backend wraps responses in an envelope:
        //   success 200: { status: 'Success', data: { exchangeCode, expiresIn }, message }
        //   error 4xx:   { status: 'error',   message, errorCode }
        const envelope = response.data as {
          status?: unknown;
          data?: { exchangeCode?: unknown; expiresIn?: unknown };
          message?: unknown;
          errorCode?: unknown;
        };

        if (response.status === 200) {
          // userId is recovered from the JWT 'sub' claim by
          // verifyExchangeCode later; we only need exchangeCode here.
          const inner = envelope?.data;
          if (typeof inner?.exchangeCode === 'string') {
            return { exchangeCode: inner.exchangeCode };
          }
          throw new BackendError('aem-backend returned malformed exchange response', 502);
        }

        if (response.status === 401) {
          const errCode = envelope?.errorCode;
          if (errCode === AemBackendOAuthErrorCode.TwoFactorRequired) {
            throw new AemBackendOAuthError(
              AemBackendOAuthErrorCode.TwoFactorRequired,
              'Two-factor authentication required',
              401,
            );
          }
          throw new AemBackendOAuthError(
            AemBackendOAuthErrorCode.InvalidCredentials,
            'Invalid email or password',
            401,
          );
        }

        if (response.status === 400) {
          // DTO validation failure (e.g. malformed email). Treat as
          // invalid creds so we don't reveal validation rules and the
          // user gets the same generic message as a wrong password.
          throw new AemBackendOAuthError(
            AemBackendOAuthErrorCode.InvalidCredentials,
            'Invalid email or password',
            400,
          );
        }

        throw new BackendError(
          `aem-backend exchange failed with status ${response.status}`,
          502,
        );
      } catch (error) {
        if (error instanceof AemBackendOAuthError || error instanceof BackendError) {
          throw error;
        }
        throw new BackendError('Failed to reach aem-backend OAuth exchange', 502);
      }
    },

    async exchangeBySession(cookieHeader: string): Promise<ExchangeResponse> {
      try {
        const response = await bySessionHttp.post(
          '',
          {},
          {
            validateStatus: () => true,
            headers: {
              'content-type': 'application/json',
              // Forward the session cookie as-is so aem-backend can
              // validate the existing session without us needing to
              // parse or re-sign anything.
              cookie: cookieHeader,
            },
          },
        );

        const envelope = response.data as {
          status?: unknown;
          data?: { exchangeCode?: unknown };
          message?: unknown;
          errorCode?: unknown;
        };

        if (response.status === 200) {
          const inner = envelope?.data;
          if (typeof inner?.exchangeCode === 'string') {
            return { exchangeCode: inner.exchangeCode };
          }
          throw new BackendError('aem-backend returned malformed exchange-by-session response', 502);
        }

        if (response.status === 401) {
          const errCode = envelope?.errorCode;
          if (errCode === AemBackendOAuthErrorCode.MissingSession) {
            throw new AemBackendOAuthError(
              AemBackendOAuthErrorCode.MissingSession,
              'No session cookie present',
              401,
            );
          }
          // Covers invalidSession, expiredSession, or any other 401 variant.
          throw new AemBackendOAuthError(
            AemBackendOAuthErrorCode.InvalidSession,
            'Session cookie is invalid or expired',
            401,
          );
        }

        if (response.status === 429) {
          throw new BackendError(
            `aem-backend rate-limited during session exchange`,
            429,
          );
        }

        throw new BackendError(
          `aem-backend exchange-by-session failed with status ${response.status}`,
          502,
        );
      } catch (error) {
        if (error instanceof AemBackendOAuthError || error instanceof BackendError) {
          throw error;
        }
        throw new BackendError('Failed to reach aem-backend session exchange', 502);
      }
    },
  };
}
