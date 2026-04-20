import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json', isolatedModules: true }],
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30_000,
  // Integration tests hit a real DB — force serial to avoid cross-test contention.
  maxWorkers: 1,
};

export default config;
