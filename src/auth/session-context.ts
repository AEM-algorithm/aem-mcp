export type SessionContext = {
  userId: number;
  email?: string;
  authority?: string;
  companyId?: number;
  /** Present when the request was authenticated with an MCP OAuth token. */
  scope?: string;
  jti?: string;
  clientId?: string;
  authKind?: 'session' | 'mcp-access-token';
};

export type JwtPayload = {
  id: number;
  email?: string;
  authority?: string;
  companyId?: number;
};
