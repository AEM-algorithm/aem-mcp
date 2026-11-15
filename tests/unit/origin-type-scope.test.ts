import { createToolRegistry, type ToolDefinition } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';
import { ToolPolicyError } from '../../src/errors/tool-policy-error';
import { ORIGIN_TYPE_TOOLS, ORIGIN_TYPE_VALUES } from '../../src/guardrails/origin-type';

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

describe('originType scope across wallet and transaction tools (DEV-4229)', () => {
  it('limits the tool set to the four origin-aware tools', () => {
    expect([...ORIGIN_TYPE_TOOLS].sort()).toEqual(
      ['get_transaction_count', 'get_wallet_count', 'list_transactions', 'list_wallets'].sort(),
    );
  });

  it('uses only canonical values that every backend endpoint accepts (no ALL, no ON_CHAIN)', () => {
    expect([...ORIGIN_TYPE_VALUES]).toEqual([
      'BLOCKCHAIN',
      'MANUAL',
      'IMPORTED',
      'COINBASE',
      'BINANCE',
      'XERO',
      'QUICKBOOKS',
    ]);
    expect(ORIGIN_TYPE_VALUES).not.toContain('ALL');
    expect(ORIGIN_TYPE_VALUES).not.toContain('ON_CHAIN');
  });

  it.each([...ORIGIN_TYPE_TOOLS])('%s exposes originType with the shared enum and default note', (name) => {
    const tool = findTool(createToolRegistry({ request: jest.fn() }), name);
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const originType = properties.originType;

    expect(originType).toBeDefined();
    expect(originType.type).toBe('string');
    expect(originType.enum).toEqual([...ORIGIN_TYPE_VALUES]);
    expect(String(originType.description)).toContain('BLOCKCHAIN (default when omitted)');
    expect(String(originType.description)).toContain('ALL is not supported');
  });

  it('exposes originType on get_wallet_count, which previously had no filters', () => {
    const tool = findTool(createToolRegistry({ request: jest.fn() }), 'get_wallet_count');
    expect(tool.inputSchema.properties).toHaveProperty('originType');
  });

  describe.each([...ORIGIN_TYPE_TOOLS])('%s forwarding', (name) => {
    it.each(['BLOCKCHAIN', 'IMPORTED', 'MANUAL'])('forwards originType=%s as a query param', async (value) => {
      const { request, handler } = callTool(name, { originType: value });
      await handler;
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          params: expect.objectContaining({ originType: value }),
        }),
      );
    });

    it('does not forward originType when omitted, so the backend default (on-chain) applies', async () => {
      const { request, handler } = callTool(name, {});
      await handler;
      const call = request.mock.calls[0][0] as { params?: Record<string, unknown> };
      expect(call.params ?? {}).not.toHaveProperty('originType');
    });

    it('treats a blank originType as omitted', async () => {
      const { request, handler } = callTool(name, { originType: '   ' });
      await handler;
      const call = request.mock.calls[0][0] as { params?: Record<string, unknown> };
      expect(call.params ?? {}).not.toHaveProperty('originType');
    });

    it('normalizes case and whitespace before forwarding', async () => {
      const { request, handler } = callTool(name, { originType: '  imported ' });
      await handler;
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ originType: 'IMPORTED' }),
        }),
      );
    });

    it.each(['ALL', 'all', 'ON_CHAIN', 'HASHKEY'])(
      'rejects unsupported originType=%s before calling the backend',
      async (value) => {
        const { request, handler } = callTool(name, { originType: value });
        await expect(handler).rejects.toThrow(ToolPolicyError);
        expect(request).not.toHaveBeenCalled();
      },
    );

    it('explains that ALL is not supported and lists the allowed values', async () => {
      const { handler } = callTool(name, { originType: 'ALL' });
      await expect(handler).rejects.toThrow(/originType=ALL is not supported/);
      await expect(handler).rejects.toThrow(/BLOCKCHAIN, MANUAL, IMPORTED/);
    });
  });

  it('does not touch originType on tools outside the origin scope', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tool = findTool(createToolRegistry({ request }), 'get_wallet');
    await tool.handler({ session: { userId: 1 }, token: 'test-token' } as never, { id: 7, originType: 'ALL' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: '/wallet/7' }));
  });
});
