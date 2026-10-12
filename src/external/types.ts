/**
 * Configuration for an external MCP server that aem-mcp proxies tools from.
 */
export type ExternalServerConfig = {
    /** Unique identifier for this server. */
    name: string;
    /** Transport type. Only 'http' is supported in this PR. */
    type: 'http';
    /** Base URL of the external MCP server. */
    url: string;
    /** Optional static Authorization header value (e.g. 'Bearer XYZ'). */
    authHeader?: string;
};

/**
 * A connected MCP client wrapping an external server, plus cached tool list.
 */
export type ExternalServerClient = {
    config: ExternalServerConfig;
    client: import('@modelcontextprotocol/sdk/client/index.js').Client;
    tools: ExternalTool[];
    close: () => Promise<void>;
};

/**
 * Lightweight representation of a tool exposed by an external MCP server.
 */
export type ExternalTool = {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
};
