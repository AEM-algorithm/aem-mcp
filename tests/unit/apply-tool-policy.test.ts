import { applyToolPolicy } from '../../src/guardrails/apply-tool-policy';
import { ToolPolicyError } from '../../src/errors/tool-policy-error';

describe('applyToolPolicy', () => {
  it('blocks get_transaction_summary', () => {
    expect(() => applyToolPolicy('get_transaction_summary', {})).toThrow(ToolPolicyError);
  });

  it('applies default limit for list_wallets', () => {
    const result = applyToolPolicy('list_wallets', {});
    expect(result.limit).toBe(50);
  });

  it('caps list_wallets limit to max', () => {
    const result = applyToolPolicy('list_wallets', { limit: 500 });
    expect(result.limit).toBe(100);
  });

  it('requires walletIds or date range for list_transactions', () => {
    expect(() => applyToolPolicy('list_transactions', {})).toThrow(ToolPolicyError);
  });

  it('allows list_transactions with walletIds', () => {
    const result = applyToolPolicy('list_transactions', { walletIds: '1,2' });
    expect(result.walletIds).toBe('1,2');
    expect(result.limit).toBe(25);
  });

  it('allows list_transactions with from and to', () => {
    const result = applyToolPolicy('list_transactions', {
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(result.from).toBe('2026-01-01');
    expect(result.to).toBe('2026-01-31');
  });
});
