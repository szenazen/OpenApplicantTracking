import { expect, test } from '@playwright/test';

/**
 * Phase 3 — recruiter home dashboard.
 *
 * Verifies the new `/dashboard` landing page:
 *   1. Renders the four stat tiles (Open jobs / In pipeline / Hires / Drops)
 *      with numeric values, sourced from `GET /home`.
 *   2. Renders the Recent activity panel.
 *   3. Still exposes the legacy `jobs-list` + `job-row` testids so other
 *      e2e specs can navigate into a job from here.
 */
test.describe('Recruiter home dashboard', () => {
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
  });

  test('renders the four pipeline stat tiles with numeric values', async ({ page }) => {
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByTestId('home-stats')).toBeVisible();

    for (const id of ['stat-open-jobs', 'stat-in-pipeline', 'stat-hires', 'stat-drops']) {
      const valueEl = page.getByTestId(`${id}-value`);
      await expect(valueEl).toBeVisible();
      const text = (await valueEl.innerText()).trim();
      // Either a number or the loading placeholder; we wait until it
      // resolves to a number.
      await expect(valueEl).toHaveText(/^\d+$/, { timeout: 10_000 });
      void text;
    }
  });

  test('renders attention + activity panels', async ({ page }) => {
    await expect(page.getByTestId('home-attention')).toBeVisible();
    await expect(page.getByTestId('home-activity')).toBeVisible();
  });

  test('renders the performance bar chart and the jobs donut', async ({ page }) => {
    const chart = page.getByTestId('perf-chart');
    await expect(chart).toBeVisible();
    // Five bars, one per metric — each is addressable for assertions.
    for (const key of ['created', 'owned', 'addedToJob', 'dropped', 'placed']) {
      await expect(page.getByTestId(`perf-bar-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId('home-jobs-donut')).toBeVisible();
    // The donut itself carries an aria-label we can target uniquely
    // (ignoring the decorative lucide icon in the panel header).
    await expect(
      page.getByTestId('home-jobs-donut').getByRole('img', { name: 'Jobs by status' }),
    ).toBeVisible();
  });

  test('keeps the all-jobs list discoverable for navigation', async ({ page }) => {
    await expect(page.getByTestId('jobs-list')).toBeVisible();
    const rows = page.getByTestId('job-row');
    await expect(rows.first()).toBeVisible();
    const before = page.url();
    await rows.first().click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    expect(page.url()).not.toBe(before);
  });
});
