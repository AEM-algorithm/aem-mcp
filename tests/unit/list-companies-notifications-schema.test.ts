import { createToolRegistry } from '../../src/tools/registry';
import type { AemBackendClient } from '../../src/clients/aem-backend-client';

describe('createToolRegistry company + notification schemas', () => {
  const backend: AemBackendClient = {
    request: jest.fn(),
  };

  it('exposes details on list_companies', () => {
    const tools = createToolRegistry(backend);
    const listCompanies = tools.find((tool) => tool.name === 'list_companies');
    expect(listCompanies).toBeDefined();

    const properties = (listCompanies!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('details');
    expect(listCompanies!.inputSchema.additionalProperties).toBe(false);
  });

  it('forwards details=true as query param for list_companies', async () => {
    const request = jest.fn().mockResolvedValue({ companies: [] });
    const tools = createToolRegistry({ request });
    const listCompanies = tools.find((tool) => tool.name === 'list_companies');
    expect(listCompanies).toBeDefined();

    await listCompanies!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { details: true },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/company',
        params: expect.objectContaining({ details: true }),
      }),
    );
  });

  it('exposes type, isRead, and search on list_notifications', () => {
    const tools = createToolRegistry(backend);
    const listNotifications = tools.find((tool) => tool.name === 'list_notifications');
    expect(listNotifications).toBeDefined();

    const properties = (listNotifications!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty('type');
    expect(properties).toHaveProperty('isRead');
    expect(properties).toHaveProperty('search');
    expect(properties).toHaveProperty('limit');
    expect(listNotifications!.inputSchema.additionalProperties).toBe(false);
  });

  it('forwards type filter as query param for list_notifications', async () => {
    const request = jest.fn().mockResolvedValue({ notifications: [] });
    const tools = createToolRegistry({ request });
    const listNotifications = tools.find((tool) => tool.name === 'list_notifications');
    expect(listNotifications).toBeDefined();

    await listNotifications!.handler(
      { session: { userId: 1 }, token: 'test-token' },
      { type: 'EXPORT_FAILED', isRead: false, limit: 20 },
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/notification',
        params: expect.objectContaining({
          type: 'EXPORT_FAILED',
          isRead: false,
          limit: 20,
        }),
      }),
    );
  });
});
