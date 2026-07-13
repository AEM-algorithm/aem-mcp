import { ToolPolicyError } from '../errors/tool-policy-error';
import { AVOID_TOOLS, PAGINATION_RULES } from './agent-defaults';

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function applyPagination(toolName: string, args: Record<string, unknown>): void {
  const rule = PAGINATION_RULES[toolName];
  if (!rule) {
    return;
  }

  const rawLimit = args.limit ?? rule.defaultLimit;
  const limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit < 1) {
    throw new ToolPolicyError(`${toolName} requires a positive numeric limit`);
  }

  args.limit = Math.min(Math.floor(limit), rule.maxLimit);
}

function validateListTransactionsFilters(args: Record<string, unknown>): void {
  const hasWalletIds = isNonEmptyString(args.walletIds);
  const hasDateRange = isNonEmptyString(args.from) && isNonEmptyString(args.to);

  if (!hasWalletIds && !hasDateRange) {
    throw new ToolPolicyError(
      'list_transactions requires walletIds or both from and to date filters',
    );
  }
}

export function applyToolPolicy(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (AVOID_TOOLS.has(toolName)) {
    throw new ToolPolicyError(
      `Tool "${toolName}" is disabled until a dedicated MCP summary API is available`,
    );
  }

  const normalized = { ...args };
  applyPagination(toolName, normalized);

  if (toolName === 'list_transactions') {
    validateListTransactionsFilters(normalized);
  }

  return normalized;
}
