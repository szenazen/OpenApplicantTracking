import { expect, test, type Page } from '@playwright/test';

/**
 * Covers the candidate drawer that opens when a Kanban card is clicked
 * (without being dragged).
 *
 * Scenarios:
 *   1. Clicking a card opens the drawer with the candidate's name and current
 *      pipeline status; the timeline renders at least one transition row
 *      (every seeded application has a "created" transition).
 *   2. Pressing `Escape` closes the drawer.
 *   3. Clicking the overlay outside the drawer closes the drawer.
 *
 * These tests are read-only: they never trigger a drag, so they stay
 * decoupled from the drag/drop tests that mutate seed state.
 */
test.describe('Kanban candidate drawer', () => {
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

  test('clicking a card opens the drawer with candidate info and status history', async ({ page }) => {
    const card = page.getByTestId('kanban-card').first();
    await expect(card).toBeVisible();
    const cardName = (await card.getByTestId('kanban-card-name').innerText()).trim();
    expect(cardName).not.toEqual('');

    await clickCard(page, card);

    const drawer = page.getByTestId('candidate-drawer');
    await expect(drawer).toBeVisible();

    // The drawer should show the same candidate name that the card showed.
    await expect(drawer.getByTestId('drawer-candidate-name')).toContainText(cardName);

    // Current status must be rendered.
    await expect(drawer.getByTestId('drawer-current-status')).toBeVisible();

    // Timeline must have at least one entry (the creation transition).
    const timelineItems = drawer.getByTestId('drawer-timeline-item');
    expect(await timelineItems.count()).toBeGreaterThan(0);
  });

  test('Escape closes the drawer', async ({ page }) => {
    const card = page.getByTestId('kanban-card').first();
    await clickCard(page, card);
    await expect(page.getByTestId('candidate-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('candidate-drawer')).toBeHidden();
  });

  test('clicking the overlay closes the drawer', async ({ page }) => {
    const card = page.getByTestId('kanban-card').first();
    await clickCard(page, card);
    await expect(page.getByTestId('candidate-drawer')).toBeVisible();
    await page.getByTestId('drawer-overlay').click();
    await expect(page.getByTestId('candidate-drawer')).toBeHidden();
  });
});

/**
 * Click a Kanban card without triggering a drag.
 *
 * @hello-pangea/dnd distinguishes drag from click based on pointer movement,
 * so a quick mousedown/mouseup at the same coordinates fires our onClick
 * handler. We click the name sub-element rather than the card wrapper to
 * make the target small and avoid any ambiguity with the drag handle.
 */
async function clickCard(page: Page, card: ReturnType<Page['getByTestId']>) {
  await card.getByTestId('kanban-card-name').click({ delay: 0 });
}
