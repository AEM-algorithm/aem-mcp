import { createToolRegistry } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';

describe('createToolRegistry originType on transaction tools (DEV-4229)', () => {
  const backend: AemBackendClient = {
    request: jest.fn(),
  };

  it('exposes originType on list_transactions', () => {
    const tools = createToolRegistry(backend);
    const listTransactions = tools.find((tool) => tool.name === 'list_transactions');
    expect(listTransactions).toBeDefined();

    const properties = (listTransactions!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('originType');
    expect(properties).toHaveProperty('walletIds');
    expect(properties).toHaveProperty('from');
    expect(properties).toHaveProperty('to');
  });

  it('exposes originType on get_transaction_count', () => {
    const tools = createToolRegistry(backend);
    const getTransactionCount = tools.find((tool) => tool.name === 'get_transaction_count');
    expect(getTransactionCount).toBeDefined();

    const properties = (getTransactionCount!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('originType');
    expect(properties).toHaveProperty('walletIds');
  });

  it('forwards originType as a query param on list_transactions', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tools = createToolRegistry({ request });
    const listTransactions = tools.find((tool) => tool.name === 'list_transactions');
    expect(listTransactions).toBeDefined();

    await listTransactions!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { originType: 'MANUAL', from: '2026-01-01', to: '2026-01-31' },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transaction/entity',
        params: expect.objectContaining({
          originType: 'MANUAL',
          from: '2026-01-01',
          to: '2026-01-31',
        }),
      }),
    );
  });

  it('forwards originType as a query param on get_transaction_count', async () => {
    const request = jest.fn().mockResolvedValue(0);
    const tools = createToolRegistry({ request });
    const getTransactionCount = tools.find((tool) => tool.name === 'get_transaction_count');
    expect(getTransactionCount).toBeDefined();

    await getTransactionCount!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { originType: 'IMPORTED', walletIds: '42' },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transaction/entity/count',
        params: expect.objectContaining({
          originType: 'IMPORTED',
          walletIds: '42',
        }),
      }),
    );
  });

  it('still requires walletIds or a full date range on list_transactions regardless of originType', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tools = createToolRegistry({ request });
    const listTransactions = tools.find((tool) => tool.name === 'list_transactions');
    expect(listTransactions).toBeDefined();

    await expect(
      listTransactions!.handler(
        { session: { userId: 1 }, token: 'test-token' },
        { originType: 'MANUAL' },
      ),
    ).rejects.toThrow(/requires walletIds or both from and to date filters/);
  });

  it('omits originType from forwarded query params when not provided on list_transactions', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tools = createToolRegistry({ request });
    const listTransactions = tools.find((tool) => tool.name === 'list_transactions');
    expect(listTransactions).toBeDefined();

    await listTransactions!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { from: '2026-01-01', to: '2026-01-31' },
    );

    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params).toEqual(
      expect.objectContaining({
        from: '2026-01-01',
        to: '2026-01-31',
      }),
    );
    expect(call.params).not.toHaveProperty('originType');
  });

  it('omits originType from forwarded query params when not provided on get_transaction_count', async () => {
    const request = jest.fn().mockResolvedValue(0);
    const tools = createToolRegistry({ request });
    const getTransactionCount = tools.find((tool) => tool.name === 'get_transaction_count');
    expect(getTransactionCount).toBeDefined();

    await getTransactionCount!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { walletIds: '42', from: '2026-01-01', to: '2026-01-31' },
    );

    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params).toEqual(
      expect.objectContaining({
        walletIds: '42',
        from: '2026-01-01',
        to: '2026-01-31',
      }),
    );
    expect(call.params).not.toHaveProperty('originType');
  });
});
