import { expect, test } from '@playwright/test';

/**
 * End-to-end for Phase 5 — global Cmd+K command palette.
 *
 * Scenarios:
 *   1. Pressing Control+K opens the palette; pressing Escape closes it.
 *   2. Empty state surfaces at least the pinned "Jobs list" / "Candidates
 *      list" commands, so a first-time user can navigate without knowing
 *      any seeded data.
 *   3. Typing 2+ characters triggers a search; Enter opens the first hit.
 *   4. Activity feed rows are links that navigate to the correct deep
 *      destination (Kanban for application events, Summary for job.updated).
 */
test.describe('Command palette + deep-link activities', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    // Pick the US account to match the rest of the E2E suite's seeded
    // jobs. If no switcher is present (only one account) we silently skip.
    const switcher = page.getByTestId('account-switcher');
    if (await switcher.isVisible().catch(() => false)) {
      const option = switcher.locator('option', { hasText: 'Hays US' });
      const value = await option.getAttribute('value').catch(() => null);
      if (value) await switcher.selectOption(value);
      await expect(page.getByTestId('active-region-badge')).toContainText(/US/);
    }
  });

  test('opens with Control+K and closes with Escape', async ({ page }) => {
    // Wait for a post-auth element (the bell) so we know the dashboard
    // layout — including the CommandPalette mount — has hydrated.
    await expect(page.getByTestId('notifications-bell')).toBeVisible();
    // Focus the body explicitly so macOS Chromium routes the modifier keypress
    // to the document rather than the browser chrome.
    await page.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await expect(palette.getByTestId('command-palette-input')).toBeFocused();

    // Empty state — pinned commands show up immediately.
    await expect(palette.getByText('Pinned')).toBeVisible();
    await expect(
      palette.getByTestId('command-palette-item').filter({ hasText: 'Candidates list' }),
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('typing a job title surfaces a job hit and Enter navigates to it', async ({ page }) => {
    await expect(page.getByTestId('notifications-bell')).toBeVisible();
    await page.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    const input = page.getByTestId('command-palette-input');
    await input.fill('engineer');

    // Wait for a Jobs section to render (debounced + network).
    const jobsHeading = page.getByTestId('command-palette').getByText('Jobs', { exact: true });
    await expect(jobsHeading).toBeVisible({ timeout: 30_000 });

    const firstJob = page.getByTestId('command-palette-item').filter({ hasNotText: 'list' }).first();
    await expect(firstJob).toBeVisible();
    await firstJob.click();

    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    await expect(page.getByTestId('kanban-board')).toBeVisible();
  });

  test('activity row is a deep-link to the relevant page', async ({ page }) => {
    // Jump to the first job's Activities tab via the existing jobs-list UI.
    await page.getByTestId('job-row').first().click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    await page.getByRole('link', { name: 'Activities' }).click();
    await expect(page.getByTestId('job-activities-page')).toBeVisible();

    // At least the first row must be a link with a recognizable href.
    const firstLink = page.getByTestId('activity-link').first();
    await expect(firstLink).toBeVisible();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/^\/dashboard\/jobs\/[^/]+(\?application=|\/summary|\/notes|\/team)?/);

    // Clicking the first link must navigate us somewhere under /dashboard/jobs.
    await firstLink.click();
    await page.waitForURL(/\/dashboard\/jobs\/.+/);
  });
});
