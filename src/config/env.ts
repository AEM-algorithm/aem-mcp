import { z } from 'zod';

const DEV_JWT_SECRET = '1234';

const envSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AEM_BACKEND_URL: z.string().url().default('http://localhost:3000/api'),
    JWT_SECRET: z.string().min(1).optional(),
  })
  .transform((data) => {
    const jwtSecret =
      data.JWT_SECRET ?? (data.NODE_ENV === 'production' ? undefined : DEV_JWT_SECRET);

    if (!jwtSecret) {
      throw new Error('Invalid environment: JWT_SECRET is required in production');
    }

    return {
      ...data,
      JWT_SECRET: jwtSecret,
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
