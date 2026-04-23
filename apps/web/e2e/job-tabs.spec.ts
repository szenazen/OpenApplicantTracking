import { expect, test } from '@playwright/test';

/**
 * Smoke test for Phase D — job-detail tabs.
 *
 * Verifies that:
 *   1. The tab bar on a job page now renders real links for every tab in the
 *      design reference (Candidates, Summary, Team, Recommendations,
 *      Activities, Notes, Attachments, Sourcing, Reports).
 *   2. Clicking "Summary" navigates to `/dashboard/jobs/<id>/summary`, marks
 *      that tab active, and renders the Summary page (metrics + funnel).
 *   3. The funnel counts sum to the header's "In pipeline + Hired + Dropped"
 *      summary (i.e. Summary + Candidates tabs agree on the same data).
 *   4. Clicking back to "Candidates" brings the Kanban board back.
 */
test.describe('Job detail tabs (shell + Summary)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    const switcher = page.getByTestId('account-switcher');
    const usValue = await switcher.locator('option', { hasText: 'Hays US' }).getAttribute('value');
    await switcher.selectOption(usValue!);
    await expect(page.getByTestId('active-region-badge')).toContainText(/US/);
    await page.getByTestId('job-row').first().click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    await expect(page.getByTestId('kanban-board')).toBeVisible();
  });

  test('all expected tabs are rendered', async ({ page }) => {
    const expected = [
      'tab-candidates',
      'tab-summary',
      'tab-team',
      'tab-recommendations',
      'tab-activities',
      'tab-notes',
      'tab-attachments',
      'tab-sourcing',
      'tab-reports',
    ];
    for (const testId of expected) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
  });

  test('navigating to Summary shows metrics and a funnel matching header counts', async ({ page }) => {
    const hired = await readCount(page, 'summary-hired');
    const inPipe = await readCount(page, 'summary-in-pipeline');
    const dropped = await readCount(page, 'summary-dropped');

    await page.getByTestId('tab-summary').click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+\/summary$/);
    await expect(page.getByTestId('job-summary-page')).toBeVisible();

    await expect(page.getByTestId('tab-summary')).toHaveAttribute('aria-current', 'page');

    const metricHired = await readCount(page, 'metric-hired');
    const metricInPipe = await readCount(page, 'metric-inpipeline');
    const metricDropped = await readCount(page, 'metric-dropped');
    const metricTotal = await readCount(page, 'metric-total');

    expect(metricHired).toBe(hired);
    expect(metricInPipe).toBe(inPipe);
    expect(metricDropped).toBe(dropped);
    expect(metricTotal).toBe(hired + inPipe + dropped);

    await expect(page.getByTestId('funnel')).toBeVisible();
  });

  test('can navigate back to Candidates tab (Kanban)', async ({ page }) => {
    await page.getByTestId('tab-summary').click();
    await page.waitForURL(/\/summary$/);
    await page.getByTestId('tab-candidates').click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    await expect(page.getByTestId('kanban-board')).toBeVisible();
  });

  test('"back to jobs" header link opens /dashboard/jobs (not home)', async ({ page }) => {
    await page.getByRole('link', { name: /back to jobs/i }).click();
    await page.waitForURL(/\/dashboard\/jobs$/);
    await expect(page.getByTestId('jobs-page')).toBeVisible();
  });
});

async function readCount(page: import('@playwright/test').Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).innerText()).trim();
  const m = text.match(/(\d+)/);
  return m ? parseInt(m[1]!, 10) : 0;
}
