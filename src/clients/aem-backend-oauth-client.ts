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
  exchangeCode: string; // HS256 JWT, aud='aem-mcp', sub=<userId>, jti, 60s TTL
  userId: number;
};

export type AemBackendOAuthClient = {
  exchange: (req: ExchangeRequest) => Promise<ExchangeResponse>;
};

export function createAemBackendOAuthClient(env: Env): AemBackendOAuthClient {
  const http: AxiosInstance = axios.create({
    baseURL: env.MCP_BACKEND_OAUTH_EXCHANGE_URL,
    timeout: 15_000,
  });

  return {
    async exchange(req: ExchangeRequest): Promise<ExchangeResponse> {
      try {
        const response = await http.post('', req, {
          validateStatus: () => true,
          headers: { 'content-type': 'application/json' },
        });

        if (response.status === 200) {
          const data = response.data as { exchangeCode?: unknown; userId?: unknown };
          if (
            typeof data?.exchangeCode === 'string' &&
            typeof data?.userId === 'number'
          ) {
            return { exchangeCode: data.exchangeCode, userId: data.userId };
          }
          throw new BackendError('aem-backend returned malformed exchange response', 502);
        }

        if (response.status === 401) {
          const body = response.data as { error?: unknown };
          const err = body?.error;
          if (err === AemBackendOAuthErrorCode.TwoFactorRequired) {
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
  };
}
