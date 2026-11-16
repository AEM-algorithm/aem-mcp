import { createToolRegistry } from '../../src/tools/registry';
import { toZodInputSchema } from '../../src/tools/json-schema-to-zod';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';

describe('get_gain_loss tool', () => {
  const backend: AemBackendClient = {
    request: jest.fn(),
  };

  const findTool = () => {
    const tool = createToolRegistry(backend).find((candidate) => candidate.name === 'get_gain_loss');
    expect(tool).toBeDefined();
    return tool!;
  };

  it('is registered as a read tool on the entity details endpoint', () => {
    const tool = findTool();
    expect(tool.description).toContain('realisedGainLoss');
    expect(tool.description).toContain('to must be on or before yesterday');
  });

  it('requires from and to and exposes only the documented params', () => {
    const tool = findTool();
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;

    expect(Object.keys(properties).sort()).toEqual(['currency', 'from', 'to', 'walletIds']);
    expect(tool.inputSchema.required).toEqual(['from', 'to']);
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  it('rejects calls without from or to, and rejects exportType/type overrides', () => {
    const schema = toZodInputSchema(findTool().inputSchema);

    expect(() => schema.parse({ to: '2026-01-31' })).toThrow();
    expect(() => schema.parse({ from: '2026-01-01' })).toThrow();
    expect(() =>
      schema.parse({ from: '2026-01-01', to: '2026-01-31', type: 'buy' }),
    ).toThrow();
    expect(() =>
      schema.parse({ from: '2026-01-01', to: '2026-01-31', exportType: 'CSV' }),
    ).toThrow();
    expect(schema.parse({ from: '2026-01-01', to: '2026-01-31', walletIds: '42' })).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
      walletIds: '42',
    });
  });

  it('posts to entity details with the balance journal params fixed', async () => {
    const request = jest.fn().mockResolvedValue({ wallets: [] });
    const tool = createToolRegistry({ request }).find((candidate) => candidate.name === 'get_gain_loss')!;

    await tool.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { walletIds: '42,43', from: '2026-01-01', to: '2026-01-31', currency: 'usd' },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/transaction/entity/details',
        params: undefined,
        body: {
          exportType: 'JOURNAL',
          type: 'Balance',
          walletIds: '42,43',
          from: '2026-01-01',
          to: '2026-01-31',
          currency: 'usd',
        },
      }),
    );
  });
});
