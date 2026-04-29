import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config.
 *
 * Runs against a full local stack:
 *   - NestJS API on :3001 (3 regional + 1 global Postgres + Redis, seeded)
 *   - Next.js web on :3002
 *
 * `webServer` spins both up if they're not already running. Tests are serial —
 * they mutate a shared DB and would collide otherwise.
 *
 * Before running: `docker compose up -d global-pg region-us-east-1-pg region-eu-west-1-pg region-ap-southeast-1-pg redis`
 * then `pnpm --filter @oat/api db:migrate && pnpm --filter @oat/api db:seed`.
 *
 * **BFF + slice (optional):** `e2e/bff-slice-smoke.spec.ts` is excluded from the
 * default `chromium` project so CI stays monolith-only. Run via
 * `pnpm test:e2e:bff-slice` (repo root) or set `E2E_BFF_SLICE=1` and
 * `E2E_BFF_WEB_URL` (defaults to `http://localhost:3002` if unset — match your
 * Next dev server). The orchestration script uses port **3012** by default to
 * avoid clashing with a dev server on :3002. See `docs/qa-pipeline-slice.md`.
 */
const bffSliceTestFile = /bff-slice-smoke\.spec\.ts$/;

const bffSliceBaseURL = process.env.E2E_BFF_WEB_URL ?? 'http://localhost:3002';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: bffSliceTestFile,
      use: { ...devices['Desktop Chrome'] },
    },
    ...(process.env.E2E_BFF_SLICE === '1'
      ? [
          {
            name: 'bff-slice',
            testMatch: bffSliceTestFile,
            use: { ...devices['Desktop Chrome'], baseURL: bffSliceBaseURL },
          },
        ]
      : []),
  ],
  // We assume the developer has the servers already running (so tests start fast).
  // To orchestrate them here, uncomment the `webServer` block below.
  // webServer: [
  //   { command: 'node dist/main.js', cwd: '../api', url: 'http://localhost:3001', reuseExistingServer: true, timeout: 60_000 },
  //   { command: 'pnpm dev', cwd: '.', url: 'http://localhost:3002/login', reuseExistingServer: true, timeout: 120_000 },
  // ],
});
