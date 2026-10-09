import { OAUTH_SCOPES, hasScope, parseScope, scopesEqual } from '../../../src/oauth/scopes';

describe('scopes', () => {
  describe('OAUTH_SCOPES', () => {
    it('contains only aem-mcp:read per D4', () => {
      expect(OAUTH_SCOPES).toEqual(['aem-mcp:read']);
    });
  });

  describe('parseScope', () => {
    it('returns empty array for empty string', () => {
      expect(parseScope('')).toEqual([]);
    });

    it('parses single scope', () => {
      expect(parseScope('aem-mcp:read')).toEqual(['aem-mcp:read']);
    });

    it('parses multiple space-delimited scopes', () => {
      expect(parseScope('aem-mcp:read aem-mcp:write')).toEqual(['aem-mcp:read', 'aem-mcp:write']);
    });

    it('trims whitespace around tokens', () => {
      expect(parseScope('  aem-mcp:read   aem-mcp:write  ')).toEqual(['aem-mcp:read', 'aem-mcp:write']);
    });

    it('drops empty tokens from repeated whitespace', () => {
      expect(parseScope('aem-mcp:read  aem-mcp:write')).toEqual(['aem-mcp:read', 'aem-mcp:write']);
    });
  });

  describe('hasScope', () => {
    it('returns true when scope is present', () => {
      expect(hasScope('aem-mcp:read aem-mcp:write', 'aem-mcp:read')).toBe(true);
    });

    it('returns false when scope is missing', () => {
      expect(hasScope('aem-mcp:write', 'aem-mcp:read')).toBe(false);
    });

    it('returns true for empty requested scope (vacuously)', () => {
      expect(hasScope('', '')).toBe(true);
    });
  });

  describe('scopesEqual', () => {
    it('returns true for identical strings', () => {
      expect(scopesEqual('aem-mcp:read', 'aem-mcp:read')).toBe(true);
    });

    it('returns true for same set in different order', () => {
      expect(scopesEqual('aem-mcp:read aem-mcp:write', 'aem-mcp:write aem-mcp:read')).toBe(true);
    });

    it('returns false for different sets', () => {
      expect(scopesEqual('aem-mcp:read', 'aem-mcp:write')).toBe(false);
    });

    it('treats both empty as equal', () => {
      expect(scopesEqual('', '')).toBe(true);
    });
  });
});
