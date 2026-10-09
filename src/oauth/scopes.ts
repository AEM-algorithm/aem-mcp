// Scope constants + helpers per spec D4 (only `aem-mcp:read` for v1).

export const OAUTH_SCOPES = ['aem-mcp:read'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const DEFAULT_SCOPE: OAuthScope = 'aem-mcp:read';

export function parseScope(input: string | undefined | null): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function hasScope(scopesString: string | undefined, required: string): boolean {
  if (!required) {
    return true;
  }
  return parseScope(scopesString).includes(required);
}

export function scopesEqual(a: string | undefined, b: string | undefined): boolean {
  const aSet = new Set(parseScope(a));
  const bSet = new Set(parseScope(b));
  if (aSet.size !== bSet.size) {
    return false;
  }
  for (const s of aSet) {
    if (!bSet.has(s)) {
      return false;
    }
  }
  return true;
}
