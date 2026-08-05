import type { Method } from 'axios';

import type { AemBackendClient } from '../clients/aem-backend-client';
import type { SessionContext } from '../auth/session-context';
import { applyToolPolicy } from '../guardrails/apply-tool-policy';
import { logError, logInfo } from '../utils/logger';

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
  /** Merged into query/body before user args (user args win on conflict). */
  fixedParams?: Record<string, unknown>;
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
      const startedAt = Date.now();
      try {
        const policyArgs = applyToolPolicy(config.name, args);
        const path = config.path instanceof Function ? config.path(policyArgs) : config.path;
        const queryParams = {
          ...(config.fixedParams ?? {}),
          ...omitPathParams(policyArgs, pathParamKeys),
        };
        const body = config.bodyKeys?.length
          ? Object.fromEntries(
              config.bodyKeys.filter((key) => policyArgs[key] != null).map((key) => [key, policyArgs[key]]),
            )
          : undefined;

        const result = await backend.request({
          method: config.method ?? 'GET',
          path,
          token: context.token,
          session: context.session,
          params: config.method === 'POST' ? undefined : queryParams,
          body: config.method === 'POST' ? { ...queryParams, ...body } : undefined,
        });

        logInfo('tool_call_success', {
          tool: config.name,
          userId: context.session.userId,
          companyId: context.session.companyId,
          durationMs: Date.now() - startedAt,
        });

        return result;
      } catch (error) {
        logError('tool_call_failed', {
          tool: config.name,
          userId: context.session.userId,
          companyId: context.session.companyId,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : 'unknown',
        });
        throw error;
      }
    },
  };
}

const READ_TOOLS: ReadToolConfig[] = [
  {
    name: 'get_account_overview',
    description:
      'Composed account snapshot: wallet totals by type, subscription status, remaining limits, setup checklist (rules/labels/contacts), unread notifications, and activeCompany (id+name) when in company session.',
    path: '/mcp/account-overview',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_wallet_summary',
    description: 'Wallet totals by type for the active company scope.',
    path: '/wallet/aggregate',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_wallets',
    description:
      'Lightweight paginated wallet list. Optional filters: q (name/address search e.g. USDT), originType, chain, archived. Sort with sortBy=balance|converted_balance and order=desc for highest; zeroBalance=true for empty wallets. For asset asks: search with q, then pass walletIds to list_transactions / get_transaction_count.',
    path: '/wallet/list-light',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        originType: { type: 'string' },
        q: {
          type: 'string',
          description: 'Search wallet name or address (e.g. USDT, Hot Wallet)',
        },
        chain: {
          type: 'string',
          description: 'Comma-separated chain codes, e.g. ETH,SOL,BTC',
        },
        archived: {
          type: 'boolean',
          description: 'When true, list archived wallets; when false or omitted, active only',
        },
        sortBy: {
          type: 'string',
          description: 'lastActionTime (default), name, balance, or converted_balance',
        },
        order: {
          type: 'string',
          description: 'asc or desc (default desc when sorting)',
        },
        zeroBalance: {
          type: 'boolean',
          description: 'When true, only wallets with persisted balance = 0',
        },
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
    description:
      'Single wallet details by id. Includes tax settings (isTaxEnable, walletTaxConfig, tax, taxDetails, taxBalanceUpdatedAt) and sync metadata (lastActionTime.lastSyncTime; fallback startSyncDate). Read-only — do not trigger sync.',
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
    description:
      'Paginated transactions with date, wallet, label, type, allocate, and sort filters. ruleLabelId=0 means unlabeled. type=buy|sell|internal. allocateType=allocated|not_allocated. search matches hash/from/to/memo/amount. For biggest txs MUST use sortBy=converted_amount and order=desc with from+to (or walletIds) and limit — do not use overview/KB alone.',
    path: '/transaction/entity',
    inputSchema: {
      type: 'object',
      properties: {
        walletIds: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        search: {
          type: 'string',
          description: 'Matches hash, from/to address, memo, or amount',
        },
        ruleLabelId: {
          type: 'integer',
          description: 'Label id filter; use 0 for unlabeled transactions',
        },
        type: {
          type: 'string',
          description: 'Transaction direction/type: buy, sell, or internal',
        },
        allocateType: {
          type: 'string',
          description: 'allocated or not_allocated',
        },
        sortBy: {
          type: 'string',
          description: 'date (default) or converted_amount for biggest-by-fiat',
        },
        order: {
          type: 'string',
          description: 'asc or desc (default desc)',
        },
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
    description:
      'Transaction count for filters without loading full rows. Supports ruleLabelId (0=unlabeled), type (buy|sell|internal), allocateType. For unlabeled counts always pass ruleLabelId=0 with from+to (or walletIds) — do not omit date/wallet scope.',
    path: '/transaction/entity/count',
    inputSchema: {
      type: 'object',
      properties: {
        walletIds: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        ruleLabelId: {
          type: 'integer',
          description: 'Label id filter; use 0 for unlabeled transactions',
        },
        type: {
          type: 'string',
          description: 'Transaction direction/type: buy, sell, or internal',
        },
        allocateType: {
          type: 'string',
          description: 'allocated or not_allocated',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_rule_count',
    description:
      'Total automation rule count for the active company scope. Use only when the user asks how many rules — not for list/show. Read totalCount from the response.',
    path: '/rules',
    fixedParams: { limit: 1 },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_rules',
    description:
      'List automation rules for the active company (list/show intents). Filter with direction (INCOMING|OUTGOING|BOTH; INCOMING/OUTGOING also matches BOTH), ruleLabelId, hasXero, hasQuickBooks. Use with limit when user asks what rules they have — not get_rule_count.',
    path: '/rules',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        contactSearch: { type: 'string' },
        walletSearch: { type: 'string' },
        direction: {
          type: 'string',
          description: 'INCOMING, OUTGOING, or BOTH. INCOMING/OUTGOING also include BOTH rules.',
        },
        ruleLabelId: {
          type: 'integer',
          description: 'Filter rules that use this rule label id',
        },
        hasXero: {
          type: 'boolean',
          description: 'true = rules with Xero export config; false = without',
        },
        hasQuickBooks: {
          type: 'boolean',
          description: 'true = rules with QuickBooks export config; false = without',
        },
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
    description:
      'List available transaction label taxonomy (names). Use for "what labels can I use" and as the REQUIRED first step for deposit/withdrawal/trade asks before list_transactions. Do not use get_rule_label without a known id.',
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
    name: 'get_contact_count',
    description:
      'Total rule-contact count for the active scope. Use only when the user asks how many contacts — not for list/show. Read totalCount from the response.',
    path: '/rule-contacts',
    fixedParams: { limit: 1 },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_rule_contacts',
    description:
      'List known counterparty addresses used by rules (list/show intents). Use hasExchangeUserId=true to list contacts that store an exchange user id. Prefer this over get_contact_count for list questions.',
    path: '/rule-contacts',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        search: { type: 'string' },
        hasExchangeUserId: {
          type: 'boolean',
          description: 'true = contacts with exchange_user_id set; false = without',
        },
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
    description:
      'Companies the user can access. Pass details=true to include per-company tierCompany and statusPaymentCompany (subscription).',
    path: '/company',
    inputSchema: {
      type: 'object',
      properties: {
        details: {
          type: 'boolean',
          description:
            'When true, include tierCompany and statusPaymentCompany for each company (subscription / payment status).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_user_profile',
    description:
      'Logged-in user profile. REQUIRED for default currency and preference/security summary: use defaultCurrency, timezone, country, appNotification, taxDetails, costTrackingMethod, needs2fa (boolean only). Do not dump personalData, passwords, nonce/signatures, or 2FA codes. Do not use get_account_overview for currency/prefs. For wallet counts prefer get_account_overview.',
    path: '/user',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_notifications',
    description:
      'List in-app notifications including export-ready download links. Use for latest notifications and filtered asks. Filter by type (e.g. EXPORT_FAILED, SYNC_FAILED, SYNC_SUCCESSFULLY), isRead, or search. Do not use get_notification_count alone for list/filter intents; never claim type filters are unavailable.',
    path: '/notification',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Comma-separated notification types. Examples: EXPORT_FAILED; SYNC_FAILED,SYNC_SUCCESSFULLY.',
        },
        isRead: {
          type: 'boolean',
          description: 'Filter by read status.',
        },
        search: {
          type: 'string',
          description: 'Optional text search when supported by the API.',
        },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_notification_count',
    description:
      'Unread notification count. Use only for how-many-unread questions; for latest/failed-export/sync lists use list_notifications.',
    path: '/notification/count',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export function createToolRegistry(backend: AemBackendClient): ToolDefinition[] {
  return READ_TOOLS.map((tool) => createReadTool(backend, tool));
}
