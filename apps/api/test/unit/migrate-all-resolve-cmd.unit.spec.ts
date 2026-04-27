import { resolvePrismaMigrateCmd } from '../../scripts/migrate-all-resolve-cmd';

describe('resolvePrismaMigrateCmd', () => {
  it('uses db push when NODE_ENV is not production', () => {
    expect(resolvePrismaMigrateCmd({ NODE_ENV: 'development' })).toBe('db push');
    expect(resolvePrismaMigrateCmd({ NODE_ENV: 'test' })).toBe('db push');
    expect(resolvePrismaMigrateCmd({})).toBe('db push');
  });

  it('uses migrate deploy in production when USE_PRISMA_DB_PUSH is unset', () => {
    expect(resolvePrismaMigrateCmd({ NODE_ENV: 'production' })).toBe('migrate deploy');
  });

  it('uses db push in production when USE_PRISMA_DB_PUSH=1', () => {
    expect(
      resolvePrismaMigrateCmd({ NODE_ENV: 'production', USE_PRISMA_DB_PUSH: '1' }),
    ).toBe('db push');
  });

  it('does not treat USE_PRISMA_DB_PUSH=true as force-push (only "1")', () => {
    expect(
      resolvePrismaMigrateCmd({ NODE_ENV: 'production', USE_PRISMA_DB_PUSH: 'true' }),
    ).toBe('migrate deploy');
  });
});
