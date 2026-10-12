import { mountExternalTools } from '@src/external/mount';
import type { ExternalServerClient, ExternalTool } from '@src/external/types';

const makeMcpServer = () => ({
    tool: jest.fn(),
    registerTool: jest.fn(),
    setRequestHandler: jest.fn(),
    registerResource: jest.fn(),
});

const makeExtClient = (
    configOverrides: Partial<{ name: string; url: string }> = {},
    tools: ExternalTool[] = [],
): ExternalServerClient => {
    return {
        config: {
            name: configOverrides.name ?? 'figma',
            type: 'http',
            url: configOverrides.url ?? 'https://mcp.figma.com/mcp',
        },
        client: {
            callTool: jest.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'result' }],
            }),
            close: jest.fn(),
        } as never,
        tools,
        close: jest.fn(),
    };
};

describe('mountExternalTools', () => {
    it('registers each external tool on the server', () => {
        const server = makeMcpServer();
        const ext = makeExtClient({}, [
            { name: 'figma_get_file', description: 'Get a Figma file', inputSchema: { type: 'object', properties: {} } },
        ]);

        mountExternalTools(server as never, [ext]);

        expect(server.registerTool).toHaveBeenCalledTimes(1);
        expect(server.registerTool).toHaveBeenCalledWith(
            'figma_get_file',
            expect.objectContaining({ description: 'Get a Figma file' }),
            expect.any(Function),
        );
    });

    it('uses default description when tool has none', () => {
        const server = makeMcpServer();
        const ext = makeExtClient({ name: 'github' }, [
            { name: 'github_list_repos', inputSchema: { type: 'object', properties: {} } },
        ]);

        mountExternalTools(server as never, [ext]);

        expect(server.registerTool).toHaveBeenCalledWith(
            'github_list_repos',
            expect.objectContaining({ description: 'Proxied from github' }),
            expect.any(Function),
        );
    });

    it('skips tools that collide with existing tool names', () => {
        const server = makeMcpServer();
        const ext = makeExtClient({}, [
            { name: 'get_account_overview', inputSchema: { type: 'object', properties: {} } },
            { name: 'unique_tool', inputSchema: { type: 'object', properties: {} } },
        ]);
        const existing = new Set(['get_account_overview']);

        mountExternalTools(server as never, [ext], existing);

        expect(server.registerTool).toHaveBeenCalledTimes(1);
        expect(server.registerTool).toHaveBeenCalledWith('unique_tool', expect.anything(), expect.any(Function));
    });

    it('adds mounted tool names to the existing set (so subsequent mounts skip them)', () => {
        const server = makeMcpServer();
        const ext1 = makeExtClient({ name: 'a' }, [
            { name: 'tool_a', inputSchema: { type: 'object', properties: {} } },
        ]);
        const ext2 = makeExtClient({ name: 'b' }, [
            { name: 'tool_a', inputSchema: { type: 'object', properties: {} } },
        ]);
        const existing = new Set<string>();

        mountExternalTools(server as never, [ext1], existing);
        mountExternalTools(server as never, [ext2], existing);

        expect(server.registerTool).toHaveBeenCalledTimes(1);
        expect(existing.has('tool_a')).toBe(true);
    });

    it('handler forwards call to external client and returns content', async () => {
        const server = makeMcpServer();
        const ext = makeExtClient({}, [
            { name: 'figma_get', inputSchema: { type: 'object', properties: {} } },
        ]);

        mountExternalTools(server as never, [ext]);
        const handler = server.registerTool.mock.calls[0][2];
        const result = await handler({ id: '123' });

        expect(ext.client.callTool).toHaveBeenCalledWith({
            name: 'figma_get',
            arguments: { id: '123' },
        });
        expect(result).toEqual({ content: [{ type: 'text', text: 'result' }] });
    });

    it('handler returns isError when external client throws', async () => {
        const server = makeMcpServer();
        const ext = makeExtClient({}, [
            { name: 'broken', inputSchema: { type: 'object', properties: {} } },
        ]);
        (ext.client.callTool as jest.Mock).mockRejectedValue(new Error('boom'));

        mountExternalTools(server as never, [ext]);
        const handler = server.registerTool.mock.calls[0][2];
        const result = await handler({});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('broken failed: boom');
    });

    it('handler stringifies non-object results', async () => {
        const server = makeMcpServer();
        const ext = makeExtClient({}, [
            { name: 'string_tool', inputSchema: { type: 'object', properties: {} } },
        ]);
        (ext.client.callTool as jest.Mock).mockResolvedValue('just a string');

        mountExternalTools(server as never, [ext]);
        const handler = server.registerTool.mock.calls[0][2];
        const result = await handler({});

        expect(result).toEqual({ content: [{ type: 'text', text: 'just a string' }] });
    });
});
