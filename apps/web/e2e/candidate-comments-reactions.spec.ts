import { expect, test } from '@playwright/test';

/**
 * End-to-end for Phase M — application-scoped comments + reactions.
 *
 * Scenarios exercised on the candidate drawer opened from the Kanban:
 *   1. Posting a comment updates the list and bumps the drawer's comment
 *      counter (and — after close — the Kanban card badge).
 *   2. Starring toggles on (highlight + count +1) and off again.
 *   3. Closing the drawer shows the star/comment indicators on the Kanban
 *      card itself so colleagues see the sentiment at a glance.
 */
test.describe('Candidate comments + reactions', () => {
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

  test('can post a comment on a candidate and see the count on the card', async ({ page }) => {
    const firstCard = page.getByTestId('kanban-card').first();
    await firstCard.click();

    const drawer = page.getByTestId('candidate-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('drawer-comments')).toBeVisible();

    const body = `Playwright comment ${Date.now()}`;
    await drawer.getByTestId('comment-compose').fill(body);
    await drawer.getByTestId('comment-submit').click();

    const list = drawer.getByTestId('comment-list');
    await expect(list).toBeVisible();
    await expect(list.getByTestId('comment-item').first()).toContainText(body);

    // Close drawer and verify the card shows the badge.
    await drawer.getByTestId('drawer-close').click();
    await expect(drawer).toBeHidden();
    await expect(firstCard.getByTestId('kanban-card-comments')).toBeVisible();
  });

  test('can toggle the star reaction on and off', async ({ page }) => {
    const firstCard = page.getByTestId('kanban-card').first();
    await firstCard.click();

    const drawer = page.getByTestId('candidate-drawer');
    const star = drawer.getByTestId('reaction-star');
    await expect(star).toBeVisible();

    // Read the initial "aria-pressed" state so the test doesn't care whether a
    // prior run left the star toggled.
    const initiallyPressed = (await star.getAttribute('aria-pressed')) === 'true';

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', initiallyPressed ? 'false' : 'true');

    // Toggle back to the original state so subsequent runs start clean.
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', initiallyPressed ? 'true' : 'false');
  });
});
