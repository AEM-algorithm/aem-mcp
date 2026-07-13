import axios, { type AxiosInstance, type Method } from 'axios';

import type { Env } from '../config/env';
import type { SessionContext } from '../auth/session-context';

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
      const response = await http.request({
        method,
        url: path,
        headers: {
          Cookie: `token=${token}`,
        },
        params: buildQueryParams(session, params),
        data: body,
      });
      return response.data;
    },
  };
}
