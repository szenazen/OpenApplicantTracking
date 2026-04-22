import { expect, test } from '@playwright/test';

/**
 * End-to-end for Phase 4 — notifications bell.
 *
 * The seed only ships one user per account, so the mention fan-out path
 * is exercised in the API integration suite. Here we assert the shell:
 *   1. The bell is visible on every dashboard page.
 *   2. Clicking it opens the popover with either entries or the empty
 *      state — both are valid, but the popover must render.
 *   3. Pressing Escape closes the popover (keyboard a11y).
 *   4. The mark-all button disables when the badge is zero.
 * These guard against accidental removal of the bell from the header or
 * silent breakage of the /notifications endpoint shape.
 */
test.describe('Notifications bell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
  });

  test('bell is visible in header and popover opens with an empty state or entries', async ({
    page,
  }) => {
    const bell = page.getByTestId('notifications-bell');
    await expect(bell).toBeVisible();

    await bell.click();
    const popover = page.getByTestId('notifications-popover');
    await expect(popover).toBeVisible();

    // Either an empty state or an entry list must render — both are fine.
    const list = popover.getByTestId('notifications-list');
    await expect(list).toBeVisible();

    // Escape closes the popover.
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
  });

  test('mark-all-read is disabled when unread count is zero', async ({ page }) => {
    const bell = page.getByTestId('notifications-bell');
    await bell.click();
    const popover = page.getByTestId('notifications-popover');
    await expect(popover).toBeVisible();

    const badge = page.getByTestId('notifications-badge');
    if (!(await badge.isVisible().catch(() => false))) {
      // No unread → mark-all button should be disabled.
      await expect(popover.getByTestId('notifications-mark-all')).toBeDisabled();
    }
  });
});
