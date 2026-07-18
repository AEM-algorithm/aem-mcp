import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { SessionContext } from '../auth/session-context';
import type { ToolDefinition } from './registry';
import { toZodInputSchema } from './json-schema-to-zod';

type ToolContext = {
  session: SessionContext;
  token: string;
};

export function registerReadTools(
  server: McpServer,
  tools: ToolDefinition[],
  getContext: () => ToolContext,
): void {
  for (const tool of tools) {
    const config = {
      description: tool.description,
      inputSchema: toZodInputSchema(tool.inputSchema),
    };

    server.registerTool(
      tool.name,
      config as { description: string },
      (async (args: Record<string, unknown>) => {
        try {
          const context = getContext();
          const result = await tool.handler(context, args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool execution failed';
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
      }) as never,
    );
  }
}
