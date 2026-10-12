import type { Env } from '../config/env';
import type { ExternalServerConfig } from './types';
import { logInfo } from '../utils/logger';

/**
 * Parse and validate the MCP_EXTERNAL_SERVERS env var.
 * Returns an empty array if the env var is not set.
 * Throws a clear error on malformed input.
 */
export function loadExternalServersFromEnv(env: Env): ExternalServerConfig[] {
    const raw = env.MCP_EXTERNAL_SERVERS;
    if (!raw || raw.trim() === '') {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(
            `Invalid MCP_EXTERNAL_SERVERS env var: must be valid JSON. Got: ${raw.slice(0, 80)}`,
        );
    }

    if (!Array.isArray(parsed)) {
        throw new Error('Invalid MCP_EXTERNAL_SERVERS env var: must be a JSON array');
    }

    const seen = new Set<string>();
    const validated: ExternalServerConfig[] = [];

    for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const config = validateConfig(item, i);
        if (seen.has(config.name)) {
            throw new Error(
                `Invalid MCP_EXTERNAL_SERVERS: duplicate name "${config.name}" at index ${i}`,
            );
        }
        seen.add(config.name);
        validated.push(config);
    }

    logInfo('external_servers_loaded', {
        count: validated.length,
        names: validated.map((c) => c.name).join(','),
    });
    return validated;
}

function validateConfig(item: unknown, index: number): ExternalServerConfig {
    if (typeof item !== 'object' || item === null) {
        throw new Error(`Invalid MCP_EXTERNAL_SERVERS[${index}]: must be an object`);
    }

    const obj = item as Record<string, unknown>;

    if (typeof obj.name !== 'string' || obj.name.length === 0) {
        throw new Error(`Invalid MCP_EXTERNAL_SERVERS[${index}].name: must be a non-empty string`);
    }

    if (obj.type !== 'http') {
        throw new Error(
            `Invalid MCP_EXTERNAL_SERVERS[${index}].type: only "http" is supported (got "${String(obj.type)}")`,
        );
    }

    if (typeof obj.url !== 'string' || obj.url.length === 0) {
        throw new Error(`Invalid MCP_EXTERNAL_SERVERS[${index}].url: must be a non-empty string`);
    }

    try {
        new URL(obj.url);
    } catch {
        throw new Error(`Invalid MCP_EXTERNAL_SERVERS[${index}].url: must be a valid URL (got "${obj.url}")`);
    }

    if (obj.authHeader !== undefined && typeof obj.authHeader !== 'string') {
        throw new Error(`Invalid MCP_EXTERNAL_SERVERS[${index}].authHeader: must be a string when present`);
    }

    return {
        name: obj.name,
        type: 'http',
        url: obj.url,
        authHeader: obj.authHeader as string | undefined,
    };
}
