import { expect, test } from '@playwright/test';

/**
 * Kanban drag-and-drop e2e.
 *
 * Starts from the seeded US account (hays-us), opens one of its jobs, drags
 * a candidate card from the first column to a different column, and asserts
 * the card is now rendered in the destination column. Also reloads the page
 * to confirm the move was persisted server-side (not just a local optimistic
 * update).
 */
test.describe('Kanban drag & drop', () => {
  test('drag a card between columns persists to the API', async ({ page }) => {
    // Login + land on jobs list for the default (US) account.
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');

    // Force US account so the test is deterministic across runs.
    const switcher = page.getByTestId('account-switcher');
    const usValue = await switcher.locator('option', { hasText: 'Hays US' }).getAttribute('value');
    expect(usValue).toBeTruthy();
    await switcher.selectOption(usValue!);
    await expect(page.getByTestId('active-region-badge')).toContainText(/US/);

    // Open the first job.
    await page.getByTestId('job-row').first().click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    await expect(page.getByTestId('kanban-board')).toBeVisible();

    // Find all columns in DOM order. Seed gives us a 7-column pipeline.
    const columns = page.locator('[data-testid^="column-"]');
    const columnCount = await columns.count();
    expect(columnCount).toBeGreaterThanOrEqual(2);

    // Non-terminal columns only, and pick an *adjacent* target in pipeline
    // order — jumping to "New" from deep stages often fails DnD / UX rules.
    const nonTerminalIdx: number[] = [];
    for (let i = 0; i < columnCount; i++) {
      const name = await columns.nth(i).getAttribute('data-column-name');
      if (name && name !== 'Hired' && name !== 'Dropped') nonTerminalIdx.push(i);
    }
    expect(nonTerminalIdx.length).toBeGreaterThanOrEqual(2);

    let sourceIdx = -1;
    for (const i of nonTerminalIdx) {
      if ((await columns.nth(i).getByTestId('kanban-card').count()) > 0) {
        sourceIdx = i;
        break;
      }
    }
    expect(sourceIdx, 'expected a non-terminal column with cards').toBeGreaterThanOrEqual(0);

    const pos = nonTerminalIdx.indexOf(sourceIdx);
    expect(pos).toBeGreaterThanOrEqual(0);
    const targetIdx = pos > 0 ? nonTerminalIdx[pos - 1]! : nonTerminalIdx[pos + 1]!;

    const card = columns.nth(sourceIdx).getByTestId('kanban-card').first();
    const cardId = await card.getAttribute('data-card-id');
    expect(cardId).toBeTruthy();

    const targetColumn = columns.nth(targetIdx);

    // Perform HTML5 drag. @hello-pangea/dnd listens for mouse events, so use
    // a real mouse-based drag.
    const cardBox = await card.boundingBox();
    const targetBox = await targetColumn.boundingBox();
    if (!cardBox || !targetBox) throw new Error('missing bounding boxes');

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    // A few intermediate moves help pangea/dnd detect the drag.
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 5, cardBox.y + cardBox.height / 2 + 5, { steps: 5 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
    await page.mouse.up();

    // The card should now live inside the target column (DnD can be slow to settle).
    await expect(targetColumn.locator(`[data-card-id="${cardId}"]`)).toBeVisible({ timeout: 25_000 });

    // Reload the page and re-check — proves the PATCH was persisted, not just optimistic.
    await page.reload();
    await expect(page.getByTestId('kanban-board')).toBeVisible();
    const columnsAfter = page.locator('[data-testid^="column-"]');
    await expect(columnsAfter.nth(targetIdx).locator(`[data-card-id="${cardId}"]`)).toBeVisible();
  });
});
