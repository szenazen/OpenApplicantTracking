import { z } from 'zod';

const Schema = z.object({
  GLOBAL_DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  USER_SERVICE_PORT: z.coerce.number().int().default(3050),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type UserServiceEnv = z.infer<typeof Schema>;

export function loadEnv(): UserServiceEnv {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`[user-service] invalid env: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  return parsed.data;
}
