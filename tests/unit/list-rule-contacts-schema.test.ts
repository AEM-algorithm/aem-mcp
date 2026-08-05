import { createToolRegistry } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';

describe('createToolRegistry list_rule_contacts hasExchangeUserId', () => {
  const backend: AemBackendClient = {
    request: jest.fn(),
  };

  it('exposes hasExchangeUserId on list_rule_contacts', () => {
    const tools = createToolRegistry(backend);
    const listContacts = tools.find((tool) => tool.name === 'list_rule_contacts');
    expect(listContacts).toBeDefined();

    const properties = (listContacts!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('hasExchangeUserId');
    expect(properties).toHaveProperty('limit');
    expect(properties).toHaveProperty('search');
  });

  it('forwards hasExchangeUserId as a query param', async () => {
    const request = jest.fn().mockResolvedValue({ rules: [] });
    const tools = createToolRegistry({ request });
    const listContacts = tools.find((tool) => tool.name === 'list_rule_contacts');
    expect(listContacts).toBeDefined();

    await listContacts!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { hasExchangeUserId: true, limit: 20 },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/rule-contacts',
        params: expect.objectContaining({
          hasExchangeUserId: true,
          limit: 20,
        }),
      }),
    );
  });
});
