/**
 * Wallet origin filter for list_wallets, get_wallet_count, list_transactions,
 * and get_transaction_count (DEV-4229).
 *
 * Contract: omitted originType means every origin the caller may see (ALL).
 * The MCP sends ALL explicitly on endpoints whose backend accepts it, so the
 * request never depends on the backend default.
 *
 * Backend (aem-backend feature/MNOPVS-4228, read-only verification):
 * - /wallet/count, /transaction/entity, /transaction/entity/count accept ALL
 *   (empty origin list = no origin filter). Their backend default when omitted
 *   is still on-chain (WALLET): that is a backend bug to fix, not a default to copy.
 * - /wallet/list-light (list_wallets) rejects ALL (@IsIn). Omitted falls back to
 *   BLOCKCHAIN. Blocked until the backend accepts ALL and defaults to it.
 *
 * ON_CHAIN is not advertised: list-light rejects it, and BLOCKCHAIN is the name
 * it accepts. Keep in sync with catalog/aem-tool-metadata.yaml and
 * catalog/aem-agent-system-prompt.md.
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

/** Tools whose backend accepts ALL. list_wallets is excluded until /wallet/list-light accepts it. */
export const ORIGIN_TYPE_ALL_SUPPORTED_TOOLS = new Set<string>([
  'get_wallet_count',
  'list_transactions',
  'get_transaction_count',
]);

export const ORIGIN_TYPE_DESCRIPTION_ALL =
  'Wallet origin scope for this call (one value per call). ' +
  'omitted = ALL: every origin this caller can see. ' +
  'ALL = same as omitted. ' +
  'BLOCKCHAIN = on-chain wallets only. ' +
  'MANUAL = manually added wallets. ' +
  'IMPORTED = every non-blockchain origin combined (manual + exchange/accounting). ' +
  'COINBASE, BINANCE, XERO, QUICKBOOKS = that single integration.';

export const ORIGIN_TYPE_DESCRIPTION_LIST_WALLETS =
  'Wallet origin scope for this call (one value per call). ' +
  'omitted = BLOCKCHAIN today: the all-origins default is blocked on aem-backend, because /wallet/list-light does not accept ALL. ' +
  'BLOCKCHAIN = on-chain wallets only. ' +
  'MANUAL = manually added wallets. ' +
  'IMPORTED = every non-blockchain origin combined. ' +
  'COINBASE, BINANCE, XERO, QUICKBOOKS = that single integration.';
