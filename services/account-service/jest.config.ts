import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30_000,
  maxWorkers: 1,
  /** Prisma + Nest can leave handles open in integration tests; CI must exit cleanly. */
  forceExit: true,
};

export default config;
