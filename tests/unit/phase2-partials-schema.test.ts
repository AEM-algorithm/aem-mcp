import { createToolRegistry } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';

describe('createToolRegistry phase2 filters and counts', () => {
  const backend: AemBackendClient = {
    request: jest.fn(),
  };

  it('exposes type and allocateType on list_transactions and get_transaction_count', () => {
    const tools = createToolRegistry(backend);
    for (const name of ['list_transactions', 'get_transaction_count'] as const) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const properties = (tool!.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(properties).toHaveProperty('ruleLabelId');
      expect(properties).toHaveProperty('type');
      expect(properties).toHaveProperty('allocateType');
    }
  });

  it('forwards unlabeled and type filters on get_transaction_count', async () => {
    const request = jest.fn().mockResolvedValue({ totalCount: 3 });
    const tools = createToolRegistry({ request });
    const countTool = tools.find((tool) => tool.name === 'get_transaction_count');
    expect(countTool).toBeDefined();

    await countTool!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { from: '2024-01-01', to: '2024-01-31', ruleLabelId: 0, type: 'sell' },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transaction/entity/count',
        params: expect.objectContaining({
          from: '2024-01-01',
          to: '2024-01-31',
          ruleLabelId: 0,
          type: 'sell',
        }),
      }),
    );
  });

  it('registers get_rule_count and get_contact_count with fixed limit=1', async () => {
    const request = jest.fn().mockResolvedValue({ totalCount: 12 });
    const tools = createToolRegistry({ request });

    const ruleCount = tools.find((tool) => tool.name === 'get_rule_count');
    const contactCount = tools.find((tool) => tool.name === 'get_contact_count');
    expect(ruleCount).toBeDefined();
    expect(contactCount).toBeDefined();

    await ruleCount!.handler({ session: { userId: 1 }, token: 't' }, {});
    await contactCount!.handler({ session: { userId: 1 }, token: 't' }, {});

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/rules',
        params: expect.objectContaining({ limit: 1 }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/rule-contacts',
        params: expect.objectContaining({ limit: 1 }),
      }),
    );
  });

  it('exposes and forwards sortBy/order on list_transactions', async () => {
    const request = jest.fn().mockResolvedValue({ items: [] });
    const tools = createToolRegistry({ request });
    const listTool = tools.find((tool) => tool.name === 'list_transactions');
    expect(listTool).toBeDefined();

    const properties = (listTool!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('sortBy');
    expect(properties).toHaveProperty('order');

    await listTool!.handler(
      { session: { userId: 1 }, token: 't' },
      {
        from: '2024-01-01',
        to: '2024-01-31',
        limit: 10,
        sortBy: 'converted_amount',
        order: 'desc',
      },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/transaction/entity',
        params: expect.objectContaining({
          sortBy: 'converted_amount',
          order: 'desc',
          limit: 10,
        }),
      }),
    );
  });
});
