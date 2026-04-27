/** Pure helper for `migrate-all.ts` — unit-tested Prisma subcommand choice. */
export type MigrateAllEnv = Record<string, string | undefined>;

export function resolvePrismaMigrateCmd(env: MigrateAllEnv): 'db push' | 'migrate deploy' {
  const usePush = env.USE_PRISMA_DB_PUSH === '1' || env.NODE_ENV !== 'production';
  return usePush ? 'db push' : 'migrate deploy';
}
