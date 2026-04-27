/** Pure helper for `migrate-all.ts` — unit-tested Prisma subcommand choice. */
export type MigrateAllEnv = Record<string, string | undefined>;

function truthyEnv(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true';
}

export function resolvePrismaMigrateCmd(env: MigrateAllEnv): 'db push' | 'migrate deploy' {
  const usePush = truthyEnv(env.USE_PRISMA_DB_PUSH) || env.NODE_ENV !== 'production';
  return usePush ? 'db push' : 'migrate deploy';
}
