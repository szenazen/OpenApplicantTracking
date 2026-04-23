import { z } from 'zod';

const Schema = z.object({
  GLOBAL_DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ACCOUNT_SERVICE_PORT: z.coerce.number().int().default(3010),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AccountServiceEnv = z.infer<typeof Schema>;

export function loadEnv(): AccountServiceEnv {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`[account-service] invalid env: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  return parsed.data;
}
