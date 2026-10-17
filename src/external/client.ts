import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ExternalServerConfig, ExternalServerClient, ExternalTool } from './types';
import { logInfo, logError } from '../utils/logger';

/**
 * Create and connect a client to an external MCP server.
 * On success: returns the connected client and a cached list of tools.
 * On failure: returns null and logs a warning; caller may skip the server.
 */
export async function createExternalServerClient(
    config: ExternalServerConfig,
): Promise<ExternalServerClient | null> {
    try {
        const transport = new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: config.authHeader
                ? { headers: { Authorization: config.authHeader } }
                : undefined,
        });

        const client = new Client(
            { name: 'aem-mcp-proxy', version: '0.1.0' },
            { capabilities: {} },
        );

        await client.connect(transport);

        const toolsResult = await client.listTools();
        const tools: ExternalTool[] = (toolsResult.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        }));

        logInfo('external_server_connected', {
            name: config.name,
            url: config.url,
            toolCount: String(tools.length),
        });

        return {
            config,
            client,
            tools,
            close: async () => {
                try {
                    await client.close();
                } catch {
                    // best-effort
                }
            },
        };
    } catch (err) {
        logError('external_server_connect_failed', {
            name: config.name,
            url: config.url,
            error: err instanceof Error ? err.message : 'unknown',
        });
        return null;
    }
}

/**
 * Connect to all configured external servers in parallel.
 * Failed connections are logged and skipped; no error is thrown.
 */
export async function createAllExternalServerClients(
    configs: ExternalServerConfig[],
): Promise<ExternalServerClient[]> {
    const results = await Promise.all(configs.map((c) => createExternalServerClient(c)));
    return results.filter((r): r is ExternalServerClient => r !== null);
}
