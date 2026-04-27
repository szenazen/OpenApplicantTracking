/**
 * Runs Prisma against:
 *   - the global datasource (GLOBAL_DATABASE_URL)
 *   - every configured regional datasource (REGION_<CODE>_DATABASE_URL)
 *
 * Uses `db push` in non-production or when USE_PRISMA_DB_PUSH is 1/true; otherwise
 * `migrate deploy` (requires migration folders).
 *
 * Usage: `pnpm db:migrate`
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolvePrismaMigrateCmd } from './migrate-all-resolve-cmd';

type Target = { label: string; schema: string; url: string };

const root = resolve(__dirname, '..');

const targets: Target[] = [];

if (process.env.GLOBAL_DATABASE_URL) {
  targets.push({
    label: 'global',
    schema: resolve(root, 'prisma/global.prisma'),
    url: process.env.GLOBAL_DATABASE_URL,
  });
}

for (const [key, value] of Object.entries(process.env)) {
  const match = key.match(/^REGION_([A-Z0-9_]+)_DATABASE_URL$/);
  if (!match || !value) continue;
  targets.push({
    label: `region:${match[1].toLowerCase().replace(/_/g, '-')}`,
    schema: resolve(root, 'prisma/regional.prisma'),
    url: value,
  });
}

if (targets.length === 0) {
  console.error('[migrate-all] No datasources configured. Set GLOBAL_DATABASE_URL and/or REGION_*_DATABASE_URL.');
  process.exit(1);
}

for (const t of targets) {
  if (!existsSync(t.schema)) {
    console.error(`[migrate-all] schema not found: ${t.schema}`);
    process.exit(1);
  }
  console.log(`\n==> Migrating ${t.label}`);
  const env = { ...process.env };
  if (t.label === 'global') {
    env.GLOBAL_DATABASE_URL = t.url;
  } else {
    env.REGIONAL_DATABASE_URL = t.url;
  }
  const cmd = resolvePrismaMigrateCmd(process.env);
  execSync(`npx prisma ${cmd} --schema "${t.schema}"`, { stdio: 'inherit', env, cwd: root });
}

console.log('\n[migrate-all] done.');
