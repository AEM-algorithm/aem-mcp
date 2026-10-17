import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExternalServerClient, ExternalTool } from './types';
import { logInfo, logWarn } from '../utils/logger';
import { toZodInputSchema } from '../tools/json-schema-to-zod';

/**
 * Mount each external tool onto the McpServer as a proxy that forwards
 * to the external server. Tool name collisions with already-registered
 * tools are logged and skipped.
 */
export function mountExternalTools(
    server: McpServer,
    clients: ExternalServerClient[],
    existingToolNames: Set<string> = new Set(),
): void {
    let mountedCount = 0;
    const skippedNames: string[] = [];

    for (const ext of clients) {
        for (const tool of ext.tools) {
            if (existingToolNames.has(tool.name)) {
                logWarn('external_tool_skipped_collision', {
                    name: tool.name,
                    server: ext.config.name,
                });
                skippedNames.push(tool.name);
                continue;
            }
            registerProxyTool(server, ext, tool);
            existingToolNames.add(tool.name);
            mountedCount++;
        }
    }

    logInfo('external_tools_mounted', {
        count: String(mountedCount),
        servers: clients.map((c) => c.config.name).join(','),
        skipped: skippedNames.join(','),
    });
}

function registerProxyTool(
    server: McpServer,
    ext: ExternalServerClient,
    tool: ExternalTool,
): void {
    // The SDK's registerTool overloads infer deeply from the concrete Zod
    // object shape. Proxied tools are dynamic, so expose the stable runtime
    // contract here and keep the inference out of the compiler's overloads.
    const dynamicServer = server as unknown as {
        registerTool: (
            name: string,
            config: { description: string; inputSchema: import('zod').ZodTypeAny },
            handler: (args: Record<string, unknown>) => Promise<unknown>,
        ) => void;
    };
    const config = {
        description: tool.description ?? `Proxied from ${ext.config.name}`,
        // Convert the upstream's JSON Schema to a Zod schema so the MCP SDK
        // can describe the tool's arguments to clients and validate them
        // before they reach the proxy handler. Without this, the SDK infers
        // an empty schema and strips all arguments (or throws — the SDK
        // requires a Zod schema, not a raw JSON Schema object).
        inputSchema: toZodInputSchema(tool.inputSchema),
    };
    dynamicServer.registerTool(
        tool.name,
        config,
        (async (args: Record<string, unknown>) => {
            try {
                const result = await ext.client.callTool({
                    name: tool.name,
                    arguments: args,
                });
                if (result && typeof result === 'object' && 'content' in result) {
                    return {
                        content: ((result as { content: unknown[] }).content ?? []) as never,
                    };
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result),
                        },
                    ],
                };
            } catch (err) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `External tool ${tool.name} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
                        },
                    ],
                };
            }
        }) as never,
    );
}
