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

    await expect(page.getByTestId('kpi-applications')).toBeVisible();
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
    await page.getByTestId('tab-reports').click();
    await page.waitForURL(/\/reports$/);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('reports-export-csv').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  });
});
