/**
 * Wallet origin filter shared by list_wallets, get_wallet_count, list_transactions,
 * and get_transaction_count (DEV-4229).
 *
 * Values are the intersection accepted by every backend endpoint on aem-backend
 * feature/MNOPVS-4228: wallet list-light (`/wallet/list-light`), wallet count
 * (`/wallet/count`), and transaction list/count (`/transaction/entity[/count]`).
 * list-light does not accept ON_CHAIN, so BLOCKCHAIN is the canonical name.
 *
 * ALL is intentionally not supported: each call shows one origin scope.
 * Keep in sync with catalog/aem-tool-metadata.yaml and catalog/aem-agent-system-prompt.md.
 */
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
  'Wallet origin scope shown by this call (one value per call). ' +
  'BLOCKCHAIN (default when omitted) = on-chain wallets only. ' +
  'MANUAL = manually added wallets. ' +
  'IMPORTED = every non-blockchain origin combined (manual + exchange/accounting). ' +
  'COINBASE, BINANCE, XERO, QUICKBOOKS = that single integration. ' +
  'ALL is not supported; call once per origin.';
