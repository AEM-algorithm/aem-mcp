/** Canonical MCP resource identifier advertised to OAuth-aware clients. */
export function getOAuthResourceBaseUrl(publicUrl: string | undefined, port: number): string {
  return (publicUrl ?? `http://localhost:${port}`).replace(/\/+$/, '');
}

/** Accept the advertised server identifier and the configured Streamable HTTP endpoint URI. */
export function isSupportedOAuthResource(resource: string, baseUrl: string): boolean {
  try {
    const requested = new URL(resource);
    const base = new URL(baseUrl);
    if (
      requested.origin !== base.origin ||
      requested.protocol !== base.protocol ||
      requested.username ||
      requested.password ||
      requested.search ||
      requested.hash
    ) {
      return false;
    }

    const normalizePath = (path: string): string => path.replace(/\/+$/, '') || '/';
    const basePath = normalizePath(base.pathname);
    const mcpPath = normalizePath(`${basePath === '/' ? '' : basePath}/mcp`);
    const requestedPath = normalizePath(requested.pathname);
    return requestedPath === basePath || requestedPath === mcpPath;
  } catch {
    return false;
  }
}
