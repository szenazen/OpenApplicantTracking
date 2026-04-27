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

  it('uses db push in production when USE_PRISMA_DB_PUSH=1 or true', () => {
    expect(
      resolvePrismaMigrateCmd({ NODE_ENV: 'production', USE_PRISMA_DB_PUSH: '1' }),
    ).toBe('db push');
    expect(
      resolvePrismaMigrateCmd({ NODE_ENV: 'production', USE_PRISMA_DB_PUSH: 'true' }),
    ).toBe('db push');
    expect(
      resolvePrismaMigrateCmd({ NODE_ENV: 'production', USE_PRISMA_DB_PUSH: 'TRUE' }),
    ).toBe('db push');
  });
});
