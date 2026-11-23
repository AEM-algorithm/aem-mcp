import { createToolRegistry, type ToolDefinition } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';
import { ToolPolicyError } from '../../src/errors/tool-policy-error';
import { ORIGIN_TYPE_ALL, ORIGIN_TYPE_TOOLS, ORIGIN_TYPE_VALUES } from '../../src/guardrails/origin-type';

// MCP explicitly sends ALL for compatibility with each endpoint's legacy omitted-origin default.
const REQUIRED_ARGS: Record<string, Record<string, unknown>> = {
  list_wallets: { limit: 10 },
  get_wallet_count: {},
  list_transactions: { walletIds: '42', limit: 25 },
  get_transaction_count: { walletIds: '42' },
};

const EXPECTED_PATH: Record<string, string> = {
  list_wallets: '/wallet/list-light',
  get_wallet_count: '/wallet/count',
  list_transactions: '/transaction/entity',
  get_transaction_count: '/transaction/entity/count',
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
    ...REQUIRED_ARGS[name],
    ...extraArgs,
  });
  return { request, handler };
}

function requestCall(request: jest.Mock): { path: string; params: Record<string, unknown> } {
  expect(request).toHaveBeenCalledTimes(1);
  const call = request.mock.calls[0][0] as { path: string; params?: Record<string, unknown> };
  return { path: call.path, params: call.params ?? {} };
}

describe.each([...ORIGIN_TYPE_TOOLS])('%s originType request mapping (DEV-4229)', (name) => {
  it('exposes ALL plus the canonical values in its schema', () => {
    const tool = findTool(createToolRegistry({ request: jest.fn() }), name);
    const originType = (tool.inputSchema.properties as Record<string, Record<string, unknown>>).originType;

    expect(originType.type).toBe('string');
    expect(originType.enum).toEqual([ORIGIN_TYPE_ALL, ...ORIGIN_TYPE_VALUES]);
    expect(String(originType.description)).toContain('broad questions use ALL');
    expect(String(originType.description)).toContain('omitted or blank input to ALL');
  });

  it('sends explicit ALL when originType is omitted', async () => {
    const { request, handler } = callTool(name, {});
    await handler;
    const call = requestCall(request);
    expect(call.path).toBe(EXPECTED_PATH[name]);
    expect(call.params).toHaveProperty('originType', 'ALL');
  });

  it('treats a blank originType as omitted (ALL)', async () => {
    const { request, handler } = callTool(name, { originType: '   ' });
    await handler;
    expect(requestCall(request).params).toHaveProperty('originType', 'ALL');
  });

  it('treats a null originType as omitted (ALL)', async () => {
    const { request, handler } = callTool(name, { originType: null });
    await handler;
    expect(requestCall(request).params).toHaveProperty('originType', 'ALL');
  });

  it('forwards explicit ALL unchanged', async () => {
    const { request, handler } = callTool(name, { originType: 'ALL' });
    await handler;
    expect(requestCall(request).params).toHaveProperty('originType', 'ALL');
  });

  it.each([...ORIGIN_TYPE_VALUES])('forwards explicit canonical value %s unchanged', async (value) => {
    const { request, handler } = callTool(name, { originType: value });
    await handler;
    expect(requestCall(request).params).toHaveProperty('originType', value);
  });

  it('normalizes case and whitespace before forwarding', async () => {
    const { request, handler } = callTool(name, { originType: '  imported ' });
    await handler;
    expect(requestCall(request).params).toHaveProperty('originType', 'IMPORTED');
  });

  it('preserves the active company session and other filters while forwarding originType', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tool = findTool(createToolRegistry({ request }), name);
    const session = { userId: 7, companyId: 23, companyName: 'Current Company' };
    const filters: Record<string, unknown> =
      name === 'list_wallets'
        ? { q: 'USDC', archived: false, limit: 20 }
        : name === 'get_wallet_count'
          ? {}
          : { walletIds: '42', from: '2026-01-01', to: '2026-01-31' };

    await tool.handler({ session, token: 'test-token' } as never, {
      ...filters,
      originType: 'IMPORTED',
    });

    const call = request.mock.calls[0][0] as {
      session: typeof session;
      params: Record<string, unknown>;
    };
    expect(call.session).toBe(session);
    expect(call.params).toEqual(expect.objectContaining({ ...filters, originType: 'IMPORTED' }));
  });

  it.each(['ON_CHAIN', 'HASHKEY', 'BLINK'])('rejects unsupported originType=%s before calling the backend', async (value) => {
    const { request, handler } = callTool(name, { originType: value });
    await expect(handler).rejects.toThrow(ToolPolicyError);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('originType scope (DEV-4229)', () => {
  it('limits the origin-aware tools to the four endpoints', () => {
    expect([...ORIGIN_TYPE_TOOLS].sort()).toEqual(
      ['get_transaction_count', 'get_wallet_count', 'list_transactions', 'list_wallets'].sort(),
    );
  });

  it('keeps the canonical values to the backend-supported origins (no ON_CHAIN)', () => {
    expect([...ORIGIN_TYPE_VALUES]).toEqual([
      'BLOCKCHAIN',
      'MANUAL',
      'IMPORTED',
      'COINBASE',
      'BINANCE',
      'XERO',
      'QUICKBOOKS',
    ]);
    expect(ORIGIN_TYPE_VALUES).not.toContain('ON_CHAIN');
  });

  it('does not touch originType on tools outside the origin scope', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tool = findTool(createToolRegistry({ request }), 'get_wallet');
    await tool.handler({ session: { userId: 1 }, token: 'test-token' } as never, { id: 7, originType: 'ALL' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: '/wallet/7' }));
  });
});
