import { expect, test } from '@playwright/test';

/**
 * End-to-end smoke for Phase K — the Reports tab.
 *
 * We don't assert specific numbers here (the seed will drift over time);
 * instead we verify the tab is wired end-to-end: the four KPI tiles
 * render, the funnel, time-in-stage and hires-over-time charts are
 * visible, and the window switcher updates the view.
 */
test.describe('Job reports tab', () => {
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

  test('renders KPIs and all three charts, window switch works', async ({ page }) => {
    await page.getByTestId('tab-reports').click();
    await page.waitForURL(/\/reports$/);
    await expect(page.getByTestId('job-reports-page')).toBeVisible();
    await expect(page.getByText('Loading…')).toBeHidden({ timeout: 30_000 });

    await expect(page.getByTestId('kpi-applications')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('kpi-in-progress')).toBeVisible();
    await expect(page.getByTestId('kpi-hired')).toBeVisible();
    await expect(page.getByTestId('kpi-dropped')).toBeVisible();

    await expect(page.getByTestId('funnel-chart')).toBeVisible();
    await expect(page.getByTestId('time-in-stage-chart')).toBeVisible();
    await expect(page.getByTestId('hires-over-time-chart')).toBeVisible();

    // Switch the window — the chart should re-render without errors.
    await page.getByTestId('reports-window-7').click();
    await expect(page.getByTestId('hires-over-time-chart')).toBeVisible();

    await expect(page.getByTestId('reports-rates')).toBeVisible();
    await expect(page.getByTestId('reports-dropoff')).toBeVisible();
  });

  test('CSV export button downloads a file', async ({ page }) => {
    test.setTimeout(120_000);
    await page.getByTestId('tab-reports').click();
    await page.waitForURL(/\/reports$/);
    await expect(page.getByText('Loading…')).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('kpi-applications')).toBeVisible({ timeout: 10_000 });

    const exportBtn = page.getByTestId('reports-export-csv');
    await exportBtn.scrollIntoViewIfNeeded();
    // Export uses fetch + Blob (no navigation), so assert the CSV GET instead of Playwright's download event.
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('reports/csv') &&
          r.request().method() === 'GET',
        { timeout: 90_000 },
      ),
      exportBtn.click(),
    ]);
    expect(res.ok(), `export failed: ${res.status()} ${res.statusText()}`).toBeTruthy();
    expect(res.headers()['content-type'] ?? '').toMatch(/csv/i);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/job|stage|candidate/i);
  });
});
