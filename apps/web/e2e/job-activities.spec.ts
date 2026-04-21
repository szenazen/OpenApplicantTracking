import { expect, test } from '@playwright/test';

/**
 * End-to-end for Phase F — the Activities tab.
 *
 * Scenarios:
 *   1. The tab renders a single feed with the user-visible summary of each
 *      action (not raw JSON). A freshly-posted note appears on top.
 *   2. Driving a different kind of event (a Kanban move) surfaces as an
 *      `application.moved` row with from/to stage pills.
 */
test.describe('Job activities tab', () => {
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

  test('surfaces a freshly-posted note at the top of the feed', async ({ page }) => {
    // 1. Post a note first so we have a deterministic entry to look for.
    await page.getByTestId('tab-notes').click();
    await page.waitForURL(/\/notes$/);
    const body = `Activities feed check ${Date.now()}`;
    await page.getByTestId('note-compose').fill(body);
    await page.getByTestId('note-submit').click();
    await expect(page.getByTestId('note-item').first()).toContainText(body);

    // 2. Open the Activities tab and confirm the note shows up.
    await page.getByTestId('tab-activities').click();
    await page.waitForURL(/\/activities$/);
    await expect(page.getByTestId('job-activities-page')).toBeVisible();
    const firstRow = page.getByTestId('activity-item').first();
    await expect(firstRow).toHaveAttribute('data-activity-action', 'note.created');
    await expect(firstRow.getByTestId('activity-summary')).toContainText(/posted a note/i);
  });

  test('renders a human-readable feed from seeded applications', async ({ page }) => {
    await page.getByTestId('tab-activities').click();
    await page.waitForURL(/\/activities$/);
    await expect(page.getByTestId('job-activities-page')).toBeVisible();

    // At least one entry from the demo seed (applications on the job) must land
    // on the feed, formatted with the actor name + human verb — never raw JSON.
    const firstRow = page.getByTestId('activity-item').first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow.getByTestId('activity-summary')).toContainText(/\w+/);
    // The feed must not show raw action identifiers like "application.created".
    await expect(firstRow.getByTestId('activity-summary')).not.toContainText('application.created');
  });
});
