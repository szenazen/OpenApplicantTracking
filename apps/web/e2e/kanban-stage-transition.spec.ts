import { expect, test } from '@playwright/test';

/**
 * Phase 2 — drop / hire confirmation modal e2e.
 *
 * Verifies that dragging a card to a column whose category is DROPPED or
 * HIRED:
 *   1. opens the StageTransitionDialog (no immediate move),
 *   2. requires a reason for DROPPED (Confirm shows an inline error first,
 *      then accepts after a preset is picked),
 *   3. on Confirm, persists the move + reason, which then surfaces in the
 *      Activities feed.
 *
 * Cancel-on-drop is verified separately to avoid leaving the test job in a
 * mutated state.
 */
test.describe('Kanban stage transition modal', () => {
  // 7 columns × ~300px don't fit in the default 1280px viewport, and our
  // mouse-driven drag needs both source and Dropped on screen. Bump it.
  test.use({ viewport: { width: 2200, height: 900 } });

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

  test('cancelling on the Dropped column leaves the card where it was', async ({ page }) => {
    const { card, cardId, sourceCol, droppedColumn } = await pickDragTargets(page);
    test.skip(!card, 'No non-terminal source column has a candidate');

    await dragCardToColumn(page, card!, droppedColumn);

    await expect(page.getByTestId('stage-transition-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('stage-transition-dialog')).toBeHidden();

    // Card should still be in source column (not in Dropped).
    await expect(droppedColumn.locator(`[data-card-id="${cardId}"]`)).toHaveCount(0);
    await expect(sourceCol!.locator(`[data-card-id="${cardId}"]`)).toBeVisible();
  });

  test('confirming a drop requires a reason and records it in Activities', async ({ page }) => {
    const { card, cardId, droppedColumn } = await pickDragTargets(page);
    test.skip(!card, 'No non-terminal source column has a candidate');

    await dragCardToColumn(page, card!, droppedColumn);

    const dialog = page.getByTestId('stage-transition-dialog');
    await expect(dialog).toBeVisible();

    // Try to confirm with no reason -> should surface an error and not move.
    await dialog.getByTestId('stage-transition-confirm').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();

    // Pick a preset and add a free-text note, then confirm.
    await dialog.getByTestId('drop-reason-experience-mismatch').click();
    await dialog.getByTestId('stage-transition-note-input').fill('Lacks payments-domain experience');
    await dialog.getByTestId('stage-transition-confirm').click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(droppedColumn.locator(`[data-card-id="${cardId}"]`)).toBeVisible({ timeout: 10_000 });

    // Activities should now mention the move with the captured reason.
    await page.getByTestId('tab-activities').click();
    await page.waitForURL(/\/activities$/);
    await expect(
      page.getByText(/Lacks payments-domain experience|Experience \/ skill mismatch/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

/**
 * Locate a draggable card in a non-terminal source column and the Dropped
 * column, ensuring the Dropped column is scrolled into view. Returns
 * `card === null` when no source candidate is available so the test can
 * skip cleanly instead of timing out.
 */
async function pickDragTargets(page: import('@playwright/test').Page) {
  const droppedColumn = page.locator('[data-column-name="Dropped"]');
  await expect(droppedColumn).toHaveCount(1);

  const columns = page.locator('[data-testid^="column-"]');
  const total = await columns.count();
  let sourceCol: import('@playwright/test').Locator | null = null;
  for (let i = 0; i < total; i++) {
    const col = columns.nth(i);
    const name = await col.getAttribute('data-column-name');
    if (name === 'Dropped' || name === 'Hired') continue;
    if ((await col.getByTestId('kanban-card').count()) > 0) {
      sourceCol = col;
      break;
    }
  }
  if (!sourceCol) {
    return { card: null, cardId: null, sourceCol: null, droppedColumn };
  }
  const card = sourceCol.getByTestId('kanban-card').first();
  const cardId = await card.getAttribute('data-card-id');
  // Make sure both the card and the Dropped column are on screen so the
  // mouse-driven drag has real bounding boxes to aim at.
  await card.scrollIntoViewIfNeeded();
  await droppedColumn.scrollIntoViewIfNeeded();
  return { card, cardId, sourceCol, droppedColumn };
}

async function dragCardToColumn(
  page: import('@playwright/test').Page,
  card: import('@playwright/test').Locator,
  targetColumn: import('@playwright/test').Locator,
) {
  const cardBox = await card.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!cardBox || !targetBox) throw new Error('missing bounding boxes');
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 5, cardBox.y + 5, { steps: 5 });
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 25 },
  );
  await page.mouse.up();
}
