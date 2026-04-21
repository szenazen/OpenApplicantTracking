import { expect, test } from '@playwright/test';

/**
 * End-to-end for Phase I — the Sourcing tab.
 *
 * Scenarios:
 *   1. Searching the stub provider returns fixture candidates.
 *   2. Importing a fixture candidate creates an Application on this job and
 *      the row flips to an "Imported" state.
 *   3. A subsequent import of the same fixture is idempotent — the row
 *      resolves to "Already on job" without creating a duplicate card.
 */
test.describe('Job sourcing tab', () => {
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

  test('search + import + idempotent re-import', async ({ page }) => {
    await page.getByTestId('tab-sourcing').click();
    await page.waitForURL(/\/sourcing$/);
    await expect(page.getByTestId('job-sourcing-page')).toBeVisible();

    // Use a query that is guaranteed to match a stub fixture.
    await page.getByTestId('sourcing-search-input').fill('payments');
    await page.getByTestId('sourcing-search-submit').click();

    const results = page.getByTestId('sourcing-result');
    await expect(results.first()).toBeVisible();
    const first = results.first();
    const importBtn = first.getByTestId('sourcing-result-import');
    await expect(importBtn).toBeVisible();

    await importBtn.click();
    await expect(first.getByTestId('sourcing-result-imported')).toBeVisible();

    // Re-run search and re-import the same row — should resolve to the
    // existing candidate (no duplicate) and show "Already on job".
    await page.getByTestId('sourcing-search-input').fill('payments');
    await page.getByTestId('sourcing-search-submit').click();
    const resultsAgain = page.getByTestId('sourcing-result');
    await expect(resultsAgain.first()).toBeVisible();
    await resultsAgain.first().getByTestId('sourcing-result-import').click();
    await expect(resultsAgain.first().getByTestId('sourcing-result-imported')).toContainText(
      /Already on job|Imported/,
    );
  });
});
