import { createToolRegistry } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';

describe('createToolRegistry list_rules filters schema', () => {
  const backend: AemBackendClient = {
    request: jest.fn(),
  };

  it('exposes direction, ruleLabelId, hasXero, and hasQuickBooks on list_rules', () => {
    const tools = createToolRegistry(backend);
    const listRules = tools.find((tool) => tool.name === 'list_rules');
    expect(listRules).toBeDefined();

    const properties = (listRules!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('direction');
    expect(properties).toHaveProperty('ruleLabelId');
    expect(properties).toHaveProperty('hasXero');
    expect(properties).toHaveProperty('hasQuickBooks');
    expect(properties).toHaveProperty('limit');
  });

  it('forwards direction, ruleLabelId, hasXero, and hasQuickBooks as query params', async () => {
    const request = jest.fn().mockResolvedValue({ rules: [] });
    const tools = createToolRegistry({ request });
    const listRules = tools.find((tool) => tool.name === 'list_rules');
    expect(listRules).toBeDefined();

    await listRules!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      {
        direction: 'INCOMING',
        ruleLabelId: 7,
        hasXero: true,
        hasQuickBooks: false,
        limit: 20,
      },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/rules',
        params: expect.objectContaining({
          direction: 'INCOMING',
          ruleLabelId: 7,
          hasXero: true,
          hasQuickBooks: false,
          limit: 20,
        }),
      }),
    );
  });
});
