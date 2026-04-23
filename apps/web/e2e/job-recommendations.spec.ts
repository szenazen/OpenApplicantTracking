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

    // The filter sidebar and search bar are always rendered.
    await expect(page.getByTestId('recommendations-filters')).toBeVisible();
    await expect(page.getByTestId('recommendations-search')).toBeVisible();

    const listOrEmpty = page
      .getByTestId('recommendations-list')
      .or(page.getByTestId('recommendations-empty'));
    await expect(listOrEmpty).toBeVisible();

    // If we do have candidates, the top row must expose the multi-signal
    // match score badge and an "Add to job" affordance.
    const list = page.getByTestId('recommendations-list');
    if (await list.isVisible()) {
      const firstRow = page.getByTestId('recommendation-row').first();
      const scoreBadge = firstRow.getByTestId('match-score');
      await expect(scoreBadge).toBeVisible();
      // Score is a number between 0 and 100.
      const pct = await scoreBadge.getAttribute('data-score-pct');
      expect(pct).not.toBeNull();
      expect(Number(pct)).toBeGreaterThanOrEqual(0);
      expect(Number(pct)).toBeLessThanOrEqual(100);
      await expect(firstRow.getByTestId('recommendation-add')).toBeVisible();
    }
  });

  test('clicking a recommendation row opens the candidate drawer', async ({ page }) => {
    await page.getByTestId('tab-recommendations').click();
    await page.waitForURL(/\/recommendations$/);
    const list = page.getByTestId('recommendations-list');
    const hasList = await list.isVisible().catch(() => false);
    test.skip(!hasList, 'No recommendation rows for this job in the current seed');
    const firstRow = page.getByTestId('recommendation-row').first();
    await firstRow.click();
    const drawer = page.getByTestId('candidate-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('drawer-preview-primary')).toBeVisible();
    await drawer.getByTestId('drawer-close').click();
    await expect(drawer).toBeHidden();
  });

  test('filter panel narrows results by location', async ({ page }) => {
    await page.getByTestId('tab-recommendations').click();
    await page.waitForURL(/\/recommendations$/);
    await expect(page.getByTestId('job-recommendations-page')).toBeVisible();

    // Apply a location filter that shouldn't match anything in the seed.
    await page.getByTestId('filter-location').fill('somewhereverynonexistentplace');
    // Debounce + fetch.
    await expect(page.getByTestId('recommendations-empty')).toBeVisible({ timeout: 5_000 });
    // The reset button should now be visible and clear the filter.
    await page.getByTestId('filters-reset').click();
    await expect(page.getByTestId('filter-location')).toHaveValue('');
  });
});
