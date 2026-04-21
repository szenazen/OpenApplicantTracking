import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config.
 *
 * Runs against a full local stack:
 *   - NestJS API on :3001 (3 regional + 1 global Postgres + Redis, seeded)
 *   - Next.js web on :3000
 *
 * `webServer` spins both up if they're not already running. Tests are serial —
 * they mutate a shared DB and would collide otherwise.
 *
 * Before running: `docker compose up -d global-pg region-us-east-1-pg region-eu-west-1-pg region-ap-southeast-1-pg redis`
 * then `pnpm --filter @oat/api db:migrate && pnpm --filter @oat/api db:seed`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // We assume the developer has the servers already running (so tests start fast).
  // To orchestrate them here, uncomment the `webServer` block below.
  // webServer: [
  //   { command: 'node dist/main.js', cwd: '../api', url: 'http://localhost:3001', reuseExistingServer: true, timeout: 60_000 },
  //   { command: 'pnpm dev', cwd: '.', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 120_000 },
  // ],
});
