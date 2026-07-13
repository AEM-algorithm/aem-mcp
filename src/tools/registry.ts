import type { Method } from 'axios';

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

type ReadToolConfig = {
  name: string;
  description: string;
  method?: Method;
  path: string | ((args: Record<string, unknown>) => string);
  inputSchema: Record<string, unknown>;
  bodyKeys?: string[];
};

function omitPathParams(
  args: Record<string, unknown>,
  pathParamKeys: string[],
): Record<string, unknown> {
  const params = { ...args };
  for (const key of pathParamKeys) {
    delete params[key];
  }
  return params;
}

function createReadTool(backend: AemBackendClient, config: ReadToolConfig): ToolDefinition {
  const pathParamKeys = config.path instanceof Function ? ['id'] : [];

  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    handler: async (context, args) => {
      const path = config.path instanceof Function ? config.path(args) : config.path;
      const queryParams = omitPathParams(args, pathParamKeys);
      const body = config.bodyKeys?.length
        ? Object.fromEntries(config.bodyKeys.filter((key) => args[key] != null).map((key) => [key, args[key]]))
        : undefined;

      return backend.request({
        method: config.method ?? 'GET',
        path,
        token: context.token,
        session: context.session,
        params: config.method === 'POST' ? undefined : queryParams,
        body: config.method === 'POST' ? { ...queryParams, ...body } : undefined,
      });
    },
  };
}

const READ_TOOLS: ReadToolConfig[] = [
  {
    name: 'get_wallet_summary',
    description: 'Wallet totals by type for the active company scope.',
    path: '/wallet/aggregate',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_wallets',
    description: 'Lightweight paginated wallet list.',
    path: '/wallet/list-light',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        originType: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_wallet_count',
    description: 'Total wallet count for the active scope.',
    path: '/wallet/count',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_wallet',
    description: 'Single wallet details by id.',
    path: (args) => `/wallet/${String(args.id)}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_subscription',
    description: 'Current subscription plan and billing summary.',
    path: '/subscription',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_subscription_status',
    description: 'Subscription tier and active or expired status.',
    path: '/subscription/status',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_subscription_available_limits',
    description: 'Remaining resource limits for the current plan.',
    path: '/subscription/available-limits',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_subscription_used_limits',
    description: 'Used resource limits for the current plan.',
    path: '/subscription/used-limits',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_transactions',
    description: 'Paginated transactions with date, wallet, and label filters.',
    path: '/transaction/entity',
    inputSchema: {
      type: 'object',
      properties: {
        walletIds: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        search: { type: 'string' },
        ruleLabelId: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_transaction',
    description: 'Single transaction by id.',
    path: (args) => `/transaction/${String(args.id)}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_transaction_summary',
    description: 'Opening/closing balance, spent/received, and category breakdown.',
    path: '/transaction/entity/details',
    inputSchema: {
      type: 'object',
      properties: {
        walletIds: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_transaction_count',
    description: 'Transaction count for filters without loading full rows.',
    path: '/transaction/entity/count',
    inputSchema: {
      type: 'object',
      properties: {
        walletIds: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        ruleLabelId: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_rules',
    description: 'Paginated automation rules for the active company scope.',
    path: '/rules',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        contactSearch: { type: 'string' },
        walletSearch: { type: 'string' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_rule',
    description: 'Single automation rule by id.',
    path: (args) => `/rules/${String(args.id)}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_rule_labels',
    description: 'Available transaction label taxonomy.',
    path: '/rule-labels',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_rule_label',
    description: 'Single rule label by id.',
    path: (args) => `/rule-labels/${String(args.id)}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_rule_contacts',
    description: 'Known counterparty addresses used by rules.',
    path: '/rule-contacts',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        search: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_rule_contact',
    description: 'Single rule contact by id.',
    path: (args) => `/rule-contacts/${String(args.id)}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_rule_contacts',
    description: 'Search rule contacts by address or name.',
    method: 'POST',
    path: '/rule-contacts/search',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      required: ['search'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_companies',
    description: 'Companies the user can access.',
    path: '/company',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_user_profile',
    description: 'Logged-in user profile and defaults.',
    path: '/user',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_notifications',
    description: 'In-app notifications including export-ready download links.',
    path: '/notification',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_notification_count',
    description: 'Unread notification count.',
    path: '/notification/count',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export function createToolRegistry(backend: AemBackendClient): ToolDefinition[] {
  return READ_TOOLS.map((tool) => createReadTool(backend, tool));
}
