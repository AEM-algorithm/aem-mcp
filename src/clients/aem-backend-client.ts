import axios, { type AxiosInstance } from 'axios';

import type { Env } from '../config/env';
import type { SessionContext } from '../auth/session-context';

export type AemBackendClient = {
  getWalletSummary: (session: SessionContext, token: string) => Promise<unknown>;
};

export function createAemBackendClient(env: Env): AemBackendClient {
  const http: AxiosInstance = axios.create({
    baseURL: env.AEM_BACKEND_URL,
    timeout: 30_000,
  });

  return {
    async getWalletSummary(session: SessionContext, token: string): Promise<unknown> {
      const response = await http.get('/wallets/summary', {
        headers: {
          Cookie: `token=${token}`,
        },
        params: session.companyId ? { companyId: session.companyId } : undefined,
      });
      return response.data;
    },
  };
}
