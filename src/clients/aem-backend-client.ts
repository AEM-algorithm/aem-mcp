import axios, { type AxiosInstance, type Method } from 'axios';

import type { Env } from '../config/env';
import type { SessionContext } from '../auth/session-context';
import { BackendError } from '../errors/backend-error';
import { extractBackendErrorMessage, normalizeBackendResponse } from '../utils/backend-response';

export type BackendRequestOptions = {
  method?: Method;
  path: string;
  token: string;
  session: SessionContext;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

export type AemBackendClient = {
  request: (options: BackendRequestOptions) => Promise<unknown>;
};

function buildQueryParams(
  session: SessionContext,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  const query: Record<string, unknown> = { ...params };
  if (session.companyId != null && query.companyId == null) {
    query.companyId = session.companyId;
  }
  return query;
}

export function createAemBackendClient(env: Env): AemBackendClient {
  const http: AxiosInstance = axios.create({
    baseURL: env.AEM_BACKEND_URL,
    timeout: 30_000,
  });

  return {
    async request(options: BackendRequestOptions): Promise<unknown> {
      const { method = 'GET', path, token, session, params, body } = options;

      try {
        const response = await http.request({
          method,
          url: path,
          headers: {
            Cookie: `token=${token}`,
          },
          params: buildQueryParams(session, params),
          data: body,
          validateStatus: () => true,
        });

        if (response.status >= 400) {
          const message = extractBackendErrorMessage(
            response.data,
            `Backend request failed with status ${response.status}`,
          );
          throw new BackendError(message, response.status);
        }

        return normalizeBackendResponse(response.data);
      } catch (error) {
        if (error instanceof BackendError) {
          throw error;
        }
        if (axios.isAxiosError(error)) {
          throw new BackendError('Failed to reach AEM backend', 502);
        }
        throw error;
      }
    },
  };
}
