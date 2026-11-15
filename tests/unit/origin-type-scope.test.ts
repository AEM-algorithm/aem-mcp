import { createToolRegistry, type ToolDefinition } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';
import { ToolPolicyError } from '../../src/errors/tool-policy-error';
import {
  ORIGIN_TYPE_ALL,
  ORIGIN_TYPE_TOOLS,
  ORIGIN_TYPE_VALUES,
  ORIGIN_TYPE_ALL_SUPPORTED_TOOLS,
} from '../../src/guardrails/origin-type';

const VALID_ARGS: Record<string, Record<string, unknown>> = {
  list_wallets: { limit: 10 },
  get_wallet_count: {},
  list_transactions: { walletIds: '42', limit: 25 },
  get_transaction_count: { walletIds: '42' },
};

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function callTool(name: string, extraArgs: Record<string, unknown>) {
  const request = jest.fn().mockResolvedValue({ items: [] });
  const backend: AemBackendClient = { request };
  const tool = findTool(createToolRegistry(backend), name);
  const handler = tool.handler({ session: { userId: 1 }, token: 'test-token' } as never, {
    ...VALID_ARGS[name],
    ...extraArgs,
  });
  return { request, handler };
}

function forwardedParams(request: jest.Mock): Record<string, unknown> {
  const call = request.mock.calls[0][0] as { params?: Record<string, unknown> };
  return call.params ?? {};
}

const ALL_CAPABLE = [...ORIGIN_TYPE_ALL_SUPPORTED_TOOLS];

describe('originType scope across wallet and transaction tools (DEV-4229)', () => {
  it('limits the tool set to the four origin-aware tools', () => {
    expect([...ORIGIN_TYPE_TOOLS].sort()).toEqual(
      ['get_transaction_count', 'get_wallet_count', 'list_transactions', 'list_wallets'].sort(),
    );
  });

  it('keeps explicit canonical values to the backend-supported origins', () => {
    expect([...ORIGIN_TYPE_VALUES]).toEqual([
      'BLOCKCHAIN',
      'MANUAL',
      'IMPORTED',
      'COINBASE',
      'BINANCE',
      'XERO',
      'QUICKBOOKS',
    ]);
    expect(ORIGIN_TYPE_ALL).toBe('ALL');
    expect(ORIGIN_TYPE_VALUES).not.toContain('ON_CHAIN');
  });

  it('exposes ALL on the count and transaction tools only (list-light rejects ALL)', () => {
    expect(ALL_CAPABLE.sort()).toEqual(
      ['get_transaction_count', 'get_wallet_count', 'list_transactions'].sort(),
    );
  });

  it.each([...ORIGIN_TYPE_TOOLS])('%s exposes originType with the enum for its endpoint', (name) => {
    const tool = findTool(createToolRegistry({ request: jest.fn() }), name);
    const originType = (tool.inputSchema.properties as Record<string, Record<string, unknown>>).originType;

    expect(originType).toBeDefined();
    expect(originType.type).toBe('string');
    const expected = ALL_CAPABLE.includes(name)
      ? ['ALL', ...ORIGIN_TYPE_VALUES]
      : [...ORIGIN_TYPE_VALUES];
    expect(originType.enum).toEqual(expected);
  });

  it('states the scope a call shows when originType is omitted', () => {
    const count = findTool(createToolRegistry({ request: jest.fn() }), 'get_wallet_count');
    const countOrigin = (count.inputSchema.properties as Record<string, Record<string, unknown>>).originType;
    expect(String(countOrigin.description)).toContain('omitted = ALL');

    const list = findTool(createToolRegistry({ request: jest.fn() }), 'list_wallets');
    const listOrigin = (list.inputSchema.properties as Record<string, Record<string, unknown>>).originType;
    expect(String(listOrigin.description)).toContain('omitted = BLOCKCHAIN');
    expect(String(listOrigin.description)).toContain('blocked');
  });

  it('get_wallet_count gets originType and defaults to ALL when omitted', async () => {
    const { request, handler } = callTool('get_wallet_count', {});
    await handler;
    expect(forwardedParams(request)).toEqual({ originType: 'ALL' });
  });

  describe.each(ALL_CAPABLE)('%s', (name) => {
    it('forwards ALL when omitted (every origin in the caller scope)', async () => {
      const { request, handler } = callTool(name, {});
      await handler;
      expect(forwardedParams(request)).toHaveProperty('originType', 'ALL');
    });

    it('treats a blank originType as omitted (ALL)', async () => {
      const { request, handler } = callTool(name, { originType: '   ' });
      await handler;
      expect(forwardedParams(request)).toHaveProperty('originType', 'ALL');
    });

    it.each(['ALL', 'BLOCKCHAIN', 'IMPORTED', 'MANUAL'])('forwards explicit originType=%s as-is', async (value) => {
      const { request, handler } = callTool(name, { originType: value });
      await handler;
      expect(forwardedParams(request)).toHaveProperty('originType', value);
    });

    it('normalizes case and whitespace before forwarding', async () => {
      const { request, handler } = callTool(name, { originType: '  all ' });
      await handler;
      expect(forwardedParams(request)).toHaveProperty('originType', 'ALL');
    });

    it.each(['ON_CHAIN', 'HASHKEY'])('rejects originType=%s before calling the backend', async (value) => {
      const { request, handler } = callTool(name, { originType: value });
      await expect(handler).rejects.toThrow(ToolPolicyError);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('list_wallets (backend list-light does not accept ALL yet)', () => {
    it.each(['BLOCKCHAIN', 'IMPORTED', 'MANUAL'])('forwards explicit originType=%s as-is', async (value) => {
      const { request, handler } = callTool('list_wallets', { originType: value });
      await handler;
      expect(forwardedParams(request)).toHaveProperty('originType', value);
    });

    it('does not send ALL, and does not forward a value when omitted (backend default applies)', async () => {
      const { request, handler } = callTool('list_wallets', {});
      await handler;
      expect(forwardedParams(request)).not.toHaveProperty('originType');
    });

    it('rejects explicit ALL before calling the backend', async () => {
      const { request, handler } = callTool('list_wallets', { originType: 'ALL' });
      await expect(handler).rejects.toThrow(/originType=ALL is not supported by list_wallets/);
      expect(request).not.toHaveBeenCalled();
    });

    it.each(['ON_CHAIN', 'HASHKEY'])('rejects originType=%s before calling the backend', async (value) => {
      const { request, handler } = callTool('list_wallets', { originType: value });
      await expect(handler).rejects.toThrow(ToolPolicyError);
      expect(request).not.toHaveBeenCalled();
    });
  });

  it('does not touch originType on tools outside the origin scope', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tool = findTool(createToolRegistry({ request }), 'get_wallet');
    await tool.handler({ session: { userId: 1 }, token: 'test-token' } as never, { id: 7, originType: 'ALL' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: '/wallet/7' }));
  });
});
