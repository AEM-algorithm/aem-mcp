import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AEM_BACKEND_URL: z.string().url().default('http://localhost:3000/api'),
  JWT_SECRET: z.string().min(1),
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
