import { expect, test, type Response } from '@playwright/test';

/**
 * End-to-end smoke for **Web BFF + pipeline slice** (jobs/pipelines rewrites).
 *
 * Prerequisite stack (see `docs/qa-pipeline-slice.md`):
 *   - `pnpm compose:gateway` (BFF :3080, backup-api, pipeline-service, slice DB, …)
 *   - Seeded global + regional DB; optional drain for Hays US so slice has jobs/cards
 *   - Next.js for tests: env **`E2E_BFF_WEB_URL`** (orchestration script defaults to
 *     **http://127.0.0.1:3012** so it does not fight with `next dev` on :3002) with
 *     **`NEXT_PUBLIC_API_URL=http://localhost:3080`**
 *
 * Run: `pnpm test:e2e:bff-slice` (repo root) — see `scripts/run-e2e-bff-slice.sh`.
 */

function apiPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function isJobsIndexUrl(url: string): boolean {
  const p = apiPathname(url);
  return p === '/api/jobs';
}

function isJobDetailUrl(url: string): boolean {
  return /^\/api\/jobs\/[^/]+$/.test(apiPathname(url));
}

function isPipelinesListUrl(url: string): boolean {
  return apiPathname(url) === '/api/pipelines';
}

async function expectOkResponse(res: Response, label: string) {
  if (res.ok()) return;
  let snippet = '';
  try {
    snippet = (await res.text()).slice(0, 500);
  } catch {
    snippet = '(body unavailable)';
  }
  expect(res.ok(), `${label} HTTP ${res.status()} — ${snippet}`).toBeTruthy();
}

test.describe('BFF + pipeline slice smoke', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ request }) => {
    const res = await request.get('http://localhost:3080/bff-health');
    expect(res.ok(), 'BFF must be up on :3080 (see docs/qa-pipeline-slice.md)').toBeTruthy();
  });

  test('GET /api/jobs, jobs/:id, and /api/pipelines succeed through Next → BFF → slice', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');

    const switcher = page.getByTestId('account-switcher');
    const usValue = await switcher.locator('option', { hasText: 'Hays US' }).getAttribute('value');
    expect(usValue).toBeTruthy();
    await switcher.selectOption(usValue!);
    await expect(page.getByTestId('active-region-badge')).toContainText(/US/);

    const jobsListResP = page.waitForResponse(
      (r) => r.request().method() === 'GET' && isJobsIndexUrl(r.url()),
    );
    await page.goto('/dashboard/jobs');
    await expectOkResponse(await jobsListResP, 'GET /api/jobs');

    await expect(page.getByTestId('jobs-page')).toBeVisible();
    const rows = page.getByTestId('jobs-row');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    expect(await rows.count()).toBeGreaterThan(0);

    const jobDetailResP = page.waitForResponse(
      (r) => r.request().method() === 'GET' && isJobDetailUrl(r.url()),
    );
    await rows.first().click();
    await expectOkResponse(await jobDetailResP, 'GET /api/jobs/:id');
    await expect(page.getByTestId('kanban-board')).toBeVisible({ timeout: 15_000 });

    const pipelinesResP = page.waitForResponse(
      (r) => r.request().method() === 'GET' && isPipelinesListUrl(r.url()),
    );
    await page.goto('/dashboard/settings/account');
    await expectOkResponse(await pipelinesResP, 'GET /api/pipelines');
    await expect(page.getByRole('heading', { name: 'Hiring pipeline' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
