/**
 * Wallet origin filter for list_wallets, get_wallet_count, list_transactions,
 * and get_transaction_count (DEV-4229).
 *
 * Contract: omitted or blank originType is normalized here to explicit ALL.
 * The MCP always sends the value explicitly, so the request does not depend on
 * endpoint-specific backend defaults.
 *
 * Backend compatibility: this remains explicit even when a backend endpoint's
 * omitted-origin default is narrower for legacy frontend compatibility.
 *
 * ON_CHAIN is not advertised; BLOCKCHAIN is the canonical name for on-chain wallets.
 * Keep in sync with catalog/aem-tool-metadata.yaml and catalog/aem-agent-system-prompt.md.
 */
export const ORIGIN_TYPE_ALL = 'ALL';

export const ORIGIN_TYPE_VALUES = [
  'BLOCKCHAIN',
  'MANUAL',
  'IMPORTED',
  'COINBASE',
  'BINANCE',
  'XERO',
  'QUICKBOOKS',
] as const;

export const ORIGIN_TYPE_TOOLS = new Set<string>([
  'list_wallets',
  'get_wallet_count',
  'list_transactions',
  'get_transaction_count',
]);

export const ORIGIN_TYPE_DESCRIPTION =
  'Choose one origin per call and keep it consistent across matching list/count queries. ' +
  'For broad questions use ALL (the MCP also converts omitted or blank input to ALL). ' +
  'BLOCKCHAIN = on-chain only; MANUAL = manually added only; ' +
  'IMPORTED = all non-blockchain origins combined, including MANUAL; ' +
  'COINBASE, BINANCE, XERO, QUICKBOOKS each select only that provider.';
