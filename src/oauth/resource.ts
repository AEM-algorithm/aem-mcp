/** Canonical MCP resource identifier advertised to OAuth-aware clients. */
export function getOAuthResourceBaseUrl(publicUrl: string | undefined, port: number): string {
  return (publicUrl ?? `http://localhost:${port}`).replace(/\/+$/, '');
}

/** Accept the advertised server identifier and the configured Streamable HTTP endpoint URI. */
export function isSupportedOAuthResource(resource: string, baseUrl: string): boolean {
  return resource === baseUrl || resource === `${baseUrl}/mcp`;
}
