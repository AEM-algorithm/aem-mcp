/**
 * Keep in sync with catalog/aem-tool-metadata.yaml → agent_defaults
 */
export type PaginationRule = {
  defaultLimit: number;
  maxLimit: number;
};

export const AVOID_TOOLS = new Set<string>(['get_transaction_summary']);

export const PAGINATION_RULES: Record<string, PaginationRule> = {
  list_wallets: { defaultLimit: 50, maxLimit: 100 },
  list_transactions: { defaultLimit: 25, maxLimit: 50 },
  list_rules: { defaultLimit: 50, maxLimit: 100 },
  list_rule_labels: { defaultLimit: 100, maxLimit: 100 },
  list_rule_contacts: { defaultLimit: 50, maxLimit: 100 },
  list_notifications: { defaultLimit: 20, maxLimit: 20 },
};
