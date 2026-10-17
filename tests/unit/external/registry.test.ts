import { loadExternalServersFromEnv } from '../../../src/external/registry';
import type { Env } from '../../../src/config/env';

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
    PORT: 3000,
    NODE_ENV: 'development',
    AEM_BACKEND_URL: 'http://localhost:3000/api',
    JWT_SECRET: '1234',
    MCP_OAUTH_SIGNING_KEY: '0'.repeat(32),
    OAUTH_ENABLED: true,
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
    OAUTH_DEVICE_CODE_TTL_SECONDS: 600,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: 2592000,
    OAUTH_DEVICE_POLL_INTERVAL_SECONDS: 2,
    OAUTH_VERIFICATION_URI: 'http://localhost:3000/oauth/authorize',
    RATE_LIMIT_OAUTH_DEVICE_PER_MIN: 5,
    RATE_LIMIT_OAUTH_TOKEN_PER_MIN: 30,
    MCP_BACKEND_OAUTH_EXCHANGE_URL: 'http://localhost:3000/api/oauth/exchange',
    MCP_EXTERNAL_SERVERS: undefined,
    ...overrides,
} as Env);

describe('loadExternalServersFromEnv', () => {
    it('returns an empty array when MCP_EXTERNAL_SERVERS is unset', () => {
        const env = makeEnv();
        const result = loadExternalServersFromEnv(env);
        expect(result).toEqual([]);
    });

    it('returns an empty array when MCP_EXTERNAL_SERVERS is empty string', () => {
        const env = makeEnv({ MCP_EXTERNAL_SERVERS: '' });
        const result = loadExternalServersFromEnv(env);
        expect(result).toEqual([]);
    });

    it('parses a valid single-server config', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify([
                { name: 'figma', type: 'http', url: 'https://mcp.figma.com/mcp' },
            ]),
        });
        const result = loadExternalServersFromEnv(env);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('figma');
        expect(result[0].type).toBe('http');
        expect(result[0].url).toBe('https://mcp.figma.com/mcp');
    });

    it('parses multiple valid server configs with authHeader', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify([
                { name: 'figma', type: 'http', url: 'https://mcp.figma.com/mcp' },
                { name: 'github', type: 'http', url: 'https://mcp.github.com/mcp', authHeader: 'Bearer XYZ' },
            ]),
        });
        const result = loadExternalServersFromEnv(env);
        expect(result).toHaveLength(2);
        expect(result[1].authHeader).toBe('Bearer XYZ');
    });

    it('throws on malformed JSON', () => {
        const env = makeEnv({ MCP_EXTERNAL_SERVERS: 'not-json{' });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/Invalid MCP_EXTERNAL_SERVERS/);
    });

    it('throws when not an array', () => {
        const env = makeEnv({ MCP_EXTERNAL_SERVERS: JSON.stringify({ name: 'figma' }) });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/must be a JSON array/);
    });

    it('throws on unknown type', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify([{ name: 'x', type: 'stdio', url: 'http://x' }]),
        });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/only "http" is supported/);
    });

    it('throws on invalid URL', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify([{ name: 'x', type: 'http', url: 'not-a-url' }]),
        });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/must be a valid URL/);
    });

    it('throws on duplicate names', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify([
                { name: 'figma', type: 'http', url: 'https://mcp.figma.com/mcp' },
                { name: 'figma', type: 'http', url: 'https://other.com/mcp' },
            ]),
        });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/duplicate name "figma"/);
    });

    it('throws when name is missing', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify([{ type: 'http', url: 'https://x.com/mcp' }]),
        });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/name.*must be a non-empty string/);
    });

    it('throws when item is not an object', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify(['not-an-object']),
        });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/must be an object/);
    });

    it('throws when url is missing', () => {
        const env = makeEnv({
            MCP_EXTERNAL_SERVERS: JSON.stringify([{ name: 'x', type: 'http' }]),
        });
        expect(() => loadExternalServersFromEnv(env)).toThrow(/url.*must be a non-empty string/);
    });
});
