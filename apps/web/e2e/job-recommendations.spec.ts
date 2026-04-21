import { expect, test } from '@playwright/test';

/**
 * End-to-end smoke for Phase J — the Recommendations tab.
 *
 * The demo seed creates jobs whose required skills are a curated subset of
 * the skill cache, so we expect the tab to render either (a) some ranked
 * candidates or (b) an explicit empty state — both are valid on a fresh
 * seed and both confirm the page is wired end-to-end.
 */
test.describe('Job recommendations tab', () => {
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

  test('renders ranked recommendations (or an empty state)', async ({ page }) => {
    await page.getByTestId('tab-recommendations').click();
    await page.waitForURL(/\/recommendations$/);
    await expect(page.getByTestId('job-recommendations-page')).toBeVisible();

    const listOrEmpty = page
      .getByTestId('recommendations-list')
      .or(page.getByTestId('recommendations-empty'));
    await expect(listOrEmpty).toBeVisible();

    // If we do have candidates, the top row must expose the match meter and
    // an "Add to job" affordance.
    const list = page.getByTestId('recommendations-list');
    if (await list.isVisible()) {
      const firstRow = page.getByTestId('recommendation-row').first();
      await expect(firstRow.getByTestId('match-meter')).toBeVisible();
      await expect(firstRow.getByTestId('recommendation-add')).toBeVisible();
    }
  });
});
