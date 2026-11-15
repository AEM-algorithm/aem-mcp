/**
 * Wallet origin filter for list_wallets, get_wallet_count, list_transactions,
 * and get_transaction_count (DEV-4229).
 *
 * Contract: omitted originType means every origin the caller may see (ALL).
 * The MCP always sends the value explicitly (ALL when omitted), so the request
 * does not depend on the backend default.
 *
 * Backend dependency: aem-backend #1842 makes /wallet/list-light accept ALL and
 * defaults all four endpoints to ALL. Until it ships, list-light rejects ALL.
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
  'Wallet origin scope for this call (one value per call). ' +
  'omitted = ALL: every origin this caller can see. ' +
  'ALL = same as omitted. ' +
  'BLOCKCHAIN = on-chain wallets only. ' +
  'MANUAL = manually added wallets. ' +
  'IMPORTED = every non-blockchain origin combined (manual + exchange/accounting). ' +
  'COINBASE, BINANCE, XERO, QUICKBOOKS = that single integration.';
