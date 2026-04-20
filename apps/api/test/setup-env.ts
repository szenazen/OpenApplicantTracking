/**
 * Loads .env (from repo root) before tests run so the Nest bootstrapping and
 * Prisma clients see the same config as local dev. CI provides these as env
 * vars directly so the file may not exist — that's fine.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '../../../.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

// Ensure a predictable JWT secret for tests even if .env is missing.
process.env.JWT_SECRET ??= 'test-secret-do-not-use-in-prod-0123456789';
process.env.NODE_ENV ??= 'test';
