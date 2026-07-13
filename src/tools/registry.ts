import type { AemBackendClient } from '../clients/aem-backend-client';
import type { SessionContext } from '../auth/session-context';

export type ToolExecutionContext = {
  session: SessionContext;
  token: string;
};

export type ToolHandler = (
  context: ToolExecutionContext,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
};

export function createToolRegistry(backend: AemBackendClient): ToolDefinition[] {
  return [
    {
      name: 'get_wallet_summary',
      description: 'Return a summary of the customer wallets for the active company scope.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      handler: async (context) => backend.getWalletSummary(context.session, context.token),
    },
  ];
}
