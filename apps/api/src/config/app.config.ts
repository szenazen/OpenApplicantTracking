import { z } from 'zod';

/**
 * Strongly-typed, validated env loader.
 * Reads REGION_<CODE>_DATABASE_URL entries dynamically and exposes them as a map.
 */
const RegionEnvSchema = z.object({
  GLOBAL_DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(14).default(10),
  REDIS_URL: z.string().url().optional(),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_URL: z.string().url().default('http://localhost:3002'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3002,http://localhost:3000'),
  SOCKETIO_PATH: z.string().default('/realtime'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_FROM: z.string().default('OpenATS <no-reply@openapplicanttracking.local>'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = ReturnType<typeof appConfig>;

export function appConfig() {
  const parsed = RegionEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[config] invalid environment:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  const env = parsed.data;

  const regions: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^REGION_([A-Z0-9_]+)_DATABASE_URL$/);
    if (match && match[1] && value) regions[normalizeRegion(match[1])] = value;
  }

  return {
    env: env.NODE_ENV,
    http: {
      port: env.API_PORT,
      corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
      webUrl: env.WEB_URL,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
      bcryptRounds: env.BCRYPT_ROUNDS,
    },
    db: {
      globalUrl: env.GLOBAL_DATABASE_URL,
      regions,
    },
    redis: {
      url: env.REDIS_URL,
    },
    realtime: {
      path: env.SOCKETIO_PATH,
    },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      from: env.SMTP_FROM,
    },
  } as const;
}

/** Normalize "US_EAST_1" → "us-east-1" to match AWS region codes. */
function normalizeRegion(code: string): string {
  return code.toLowerCase().replace(/_/g, '-');
}
