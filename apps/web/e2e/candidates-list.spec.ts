import { expect, test } from '@playwright/test';

/**
 * Covers the dedicated `/dashboard/candidates` list view.
 *
 * Scenarios:
 *   1. The Candidates nav link takes the user to the list, which renders
 *      a table with at least one seeded row and a non-empty active-count.
 *   2. The search box filters rows client-side by candidate name.
 */
test.describe('Candidates list', () => {
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

  test('navigates to Candidates and shows the seeded list with an active count', async ({ page }) => {
    await page.getByTestId('nav-candidates').click();
    await page.waitForURL('**/dashboard/candidates');
    await expect(page.getByTestId('candidates-page')).toBeVisible();

    // Wait for the first row to land — list is fetched client-side.
    const rows = page.getByTestId('candidate-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);

    // The first row must expose the active/total counts chip.
    const activeCounts = await page.getByTestId('candidate-active-count').allInnerTexts();
    expect(activeCounts.length).toBeGreaterThan(0);
    // At least one candidate should have >=1 active application from the seed.
    const maxActive = Math.max(...activeCounts.map((t) => parseInt(t, 10) || 0));
    expect(maxActive).toBeGreaterThanOrEqual(1);
  });

  test('filter box narrows the list by candidate name', async ({ page }) => {
    await page.goto('/dashboard/candidates');
    await expect(page.getByTestId('candidates-page')).toBeVisible();
    await expect(page.getByTestId('candidate-row').first()).toBeVisible();

    const firstName = (await page.getByTestId('candidate-name').first().innerText()).split(' ')[0]!;
    const before = await page.getByTestId('candidate-row').count();

    await page.getByTestId('candidates-filter').fill(firstName);
    // Give React a tick to re-render.
    await expect
      .poll(async () => page.getByTestId('candidate-row').count(), { timeout: 2000 })
      .toBeLessThanOrEqual(before);

    const afterNames = await page.getByTestId('candidate-name').allInnerTexts();
    expect(afterNames.length).toBeGreaterThan(0);
    for (const n of afterNames) {
      expect(n.toLowerCase()).toContain(firstName.toLowerCase());
    }
  });
});
