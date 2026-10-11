import { z } from 'zod';

const DEV_JWT_SECRET = '1234';
const MIN_SIGNING_KEY_BYTES = 32;

const envSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AEM_BACKEND_URL: z.string().url().default('http://localhost:3000/api'),
    JWT_SECRET: z.string().min(1).optional(),

    // Phase 3 (OAuth foundation) — all optional with safe defaults so the
    // pre-OAuth surface keeps working unchanged.
    MCP_OAUTH_SIGNING_KEY: z.string().optional(),
    OAUTH_ENABLED: z
      .union([z.literal('true'), z.literal('false'), z.boolean()])
      .default('true')
      .transform((v) => v === true || v === 'true'),
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    OAUTH_DEVICE_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    OAUTH_DEVICE_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(2),
    OAUTH_VERIFICATION_URI: z
      .string()
      .url()
      .default('http://localhost:3000/oauth/authorize'),

    // Rate limit budgets (per IP per 60s window). Spec D7:
    //   /oauth/device → 5/min, /oauth/token → 30/min.
    RATE_LIMIT_OAUTH_DEVICE_PER_MIN: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_OAUTH_TOKEN_PER_MIN: z.coerce.number().int().positive().default(30),

    // Phase 4 — aem-backend OAuth exchange endpoint. Optional here so
    // Phase 3 can boot without the exchange wiring.
    MCP_BACKEND_OAUTH_EXCHANGE_URL: z
      .string()
      .url()
      .default('http://localhost:3000/api/oauth/exchange'),

    // Phase 5 follow-up — aem-backend session bridge. The Bearer path on
    // /mcp calls this to exchange an MCP access_token for a session_token
    // (aem-backend tool API only accepts session cookies). Optional so the
    // server can boot when the companion backend PR is not yet deployed;
    // when unset, Bearer tool calls fail with 503.
    MCP_BACKEND_SESSION_URL: z.string().url().optional(),
  })
  .transform((data) => {
    const jwtSecret =
      data.JWT_SECRET ?? (data.NODE_ENV === 'production' ? undefined : DEV_JWT_SECRET);

    if (!jwtSecret) {
      throw new Error('Invalid environment: JWT_SECRET is required in production');
    }

    // OAuth signing key: in development/test, fall back to a clearly-marked
    // dev value that satisfies the min-length check. In production, the
    // operator MUST set it explicitly (RFC 8628 + D2: shared HMAC secret).
    const isProd = data.NODE_ENV === 'production';
    const devSigningKey = '0'.repeat(MIN_SIGNING_KEY_BYTES);
    const signingKey = data.MCP_OAUTH_SIGNING_KEY ?? (isProd ? undefined : devSigningKey);

    if (!signingKey) {
      throw new Error(
        `Invalid environment: MCP_OAUTH_SIGNING_KEY is required in production ` +
          `(min ${MIN_SIGNING_KEY_BYTES} bytes)`,
      );
    }
    if (Buffer.byteLength(signingKey, 'utf8') < MIN_SIGNING_KEY_BYTES) {
      throw new Error(
        `Invalid environment: MCP_OAUTH_SIGNING_KEY must be at least ` +
          `${MIN_SIGNING_KEY_BYTES} bytes (got ${Buffer.byteLength(signingKey, 'utf8')})`,
      );
    }

    return {
      ...data,
      JWT_SECRET: jwtSecret,
      MCP_OAUTH_SIGNING_KEY: signingKey,
    };
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid environment: ${message}`);
  }
  return parsed.data;
}
