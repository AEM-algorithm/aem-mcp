import { createToolRegistry } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';

describe('createToolRegistry list_wallets schema', () => {
  const backend: AemBackendClient = {
    request: jest.fn(),
  };

  it('exposes chain, archived, q, sortBy, order, and zeroBalance on list_wallets', () => {
    const tools = createToolRegistry(backend);
    const listWallets = tools.find((tool) => tool.name === 'list_wallets');
    expect(listWallets).toBeDefined();

    const properties = (listWallets!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('chain');
    expect(properties).toHaveProperty('archived');
    expect(properties).toHaveProperty('q');
    expect(properties).toHaveProperty('originType');
    expect(properties).toHaveProperty('sortBy');
    expect(properties).toHaveProperty('order');
    expect(properties).toHaveProperty('zeroBalance');
    expect(properties).toHaveProperty('limit');
  });

  it('forwards chain, archived, and q as query params', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tools = createToolRegistry({ request });
    const listWallets = tools.find((tool) => tool.name === 'list_wallets');
    expect(listWallets).toBeDefined();

    await listWallets!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { chain: 'ETH', archived: false, q: 'USDT', limit: 10 },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/wallet/list-light',
        params: expect.objectContaining({
          chain: 'ETH',
          archived: false,
          q: 'USDT',
          limit: 10,
        }),
      }),
    );
  });

  it('forwards sortBy, order, and zeroBalance as query params', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tools = createToolRegistry({ request });
    const listWallets = tools.find((tool) => tool.name === 'list_wallets');
    expect(listWallets).toBeDefined();

    await listWallets!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { sortBy: 'balance', order: 'desc', zeroBalance: true, limit: 5 },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/wallet/list-light',
        params: expect.objectContaining({
          sortBy: 'balance',
          order: 'desc',
          zeroBalance: true,
          limit: 5,
        }),
      }),
    );
  });
});
