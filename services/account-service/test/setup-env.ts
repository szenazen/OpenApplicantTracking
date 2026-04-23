/**
 * Match repo root `.env` when present; CI injects variables directly.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '../../../.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

process.env.JWT_SECRET ??= 'test-secret-do-not-use-in-prod-0123456789';
process.env.GLOBAL_DATABASE_URL ??=
  'postgresql://oat:oat@localhost:5432/oat_global?schema=public';
process.env.NODE_ENV ??= 'test';
