import { expect, test } from '@playwright/test';

/**
 * Covers the dedicated `/dashboard/jobs` table view — the new requisitions
 * index that replaced the inline "All jobs" block on the home page.
 *
 * Scenarios:
 *   1. The Jobs nav link takes the user to the table; the table renders
 *      with the reference columns (Name, Client, Location, # of
 *      Candidates, Head Count, Status, Date of submission) and at least
 *      one seeded row with a candidate count chip.
 *   2. The search box filters rows server-side by job title / client with
 *      URL persistence, so a reload reproduces the filtered view.
 *   3. Clicking anywhere on a job row navigates to the Kanban shell.
 *   4. "View all" link on the home page jumps to the Jobs table.
 */
test.describe('Jobs list', () => {
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

  test('navigates to Jobs and renders the table with reference columns', async ({ page }) => {
    await page.getByTestId('nav-jobs').click();
    await page.waitForURL('**/dashboard/jobs');
    await expect(page.getByTestId('jobs-page')).toBeVisible();

    const rows = page.getByTestId('jobs-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);

    // Reference columns visible in the table header.
    const thead = page.locator('thead');
    await expect(thead).toContainText('Name');
    await expect(thead).toContainText('Owner');
    await expect(thead).toContainText('Client');
    await expect(thead).toContainText('Location');
    await expect(thead).toContainText('# of Candidates');
    await expect(thead).toContainText('Head Count');
    await expect(thead).toContainText('Status');
    await expect(thead).toContainText('Date of submission');

    // Each row must carry candidate counts, head count and a status pill
    // so the page is useful at a glance even without clicking in.
    await expect(page.getByTestId('jobs-candidates').first()).toBeVisible();
    await expect(page.getByTestId('jobs-headcount').first()).toBeVisible();
    await expect(page.getByTestId('jobs-status-pill').first()).toBeVisible();
  });

  test('search filters by title with URL persistence', async ({ page }) => {
    await page.goto('/dashboard/jobs');
    await expect(page.getByTestId('jobs-page')).toBeVisible();
    await expect(page.getByTestId('jobs-row').first()).toBeVisible();

    // Grab the first word of the first job title to use as a filter —
    // robust across regions because the seed always creates some jobs
    // with distinct titles.
    const firstTitle = (await page.getByTestId('jobs-title').first().innerText()).trim();
    const token = firstTitle.split(' ')[0]!;

    await page.getByTestId('jobs-filter').fill(token);
    // Server-side filter with 250ms debounce + URL round-trip; wait for
    // both the URL and the rendered rows to settle.
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(token)}`));
    await expect
      .poll(
        async () => {
          const titles = await page.getByTestId('jobs-title').allInnerTexts();
          if (titles.length === 0) return false;
          return titles.every((t) => t.toLowerCase().includes(token.toLowerCase()));
        },
        { timeout: 3000 },
      )
      .toBe(true);

    // Reloading the page reproduces the filter from the URL alone.
    await page.reload();
    await expect(page.getByTestId('jobs-page')).toBeVisible();
    await expect(page.getByTestId('jobs-filter')).toHaveValue(token);
  });

  test('clicking a job row navigates to the job detail shell', async ({ page }) => {
    await page.goto('/dashboard/jobs');
    await expect(page.getByTestId('jobs-page')).toBeVisible();
    const row = page.getByTestId('jobs-row').first();
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+/);
    await expect(page.getByTestId('kanban-board')).toBeVisible();
  });

  test('home "View all" link jumps to the Jobs table', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await page.getByTestId('home-view-all-jobs').click();
    await page.waitForURL('**/dashboard/jobs');
    await expect(page.getByTestId('jobs-page')).toBeVisible();
  });
});
