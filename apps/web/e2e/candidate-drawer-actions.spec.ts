import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 6 — interactive surfaces inside the candidate drawer:
 *   - deep-link auto-open via `?application=<id>`,
 *   - stage control (move through the pipeline without dragging),
 *   - inline edit of candidate fields (headline in particular — it's the
 *     field least likely to collide with other seed-coupled tests).
 *
 * Each test restores whatever state it mutated so the broader test suite
 * stays hermetic on the shared seed dataset.
 */
test.describe('Candidate drawer actions', () => {
  // The stage control relies on being able to see at least 2 non-terminal
  // columns side-by-side to reliably assert placement, so we widen the
  // viewport the same way the stage-transition spec does.
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

  test('opening the drawer from a Kanban click writes ?application= to the URL', async ({ page }) => {
    const card = page.getByTestId('kanban-card').first();
    const cardId = await card.getAttribute('data-card-id');
    expect(cardId).toBeTruthy();

    await clickCard(page, card);
    const drawer = page.getByTestId('candidate-drawer');
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]application=${cardId}`));

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/application=/);
  });

  test('deep-linking ?application=<id> auto-opens the drawer', async ({ page }) => {
    const card = page.getByTestId('kanban-card').first();
    const cardId = await card.getAttribute('data-card-id');
    expect(cardId).toBeTruthy();

    // Simulate a fresh landing on the URL (e.g. following an Activities
    // deep-link) and assert the drawer opens on its own.
    const currentUrl = page.url();
    const separator = currentUrl.includes('?') ? '&' : '?';
    await page.goto(`${currentUrl}${separator}application=${cardId}`);
    const drawer = page.getByTestId('candidate-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('drawer-candidate-name')).toBeVisible();
  });

  test('inline-editing the headline saves via PATCH and is reflected in the drawer', async ({
    page,
  }) => {
    const card = page.getByTestId('kanban-card').first();
    await clickCard(page, card);
    const drawer = page.getByTestId('candidate-drawer');
    await expect(drawer).toBeVisible();

    // Open the edit form.
    await drawer.getByTestId('drawer-identity-edit').click();
    const form = drawer.getByTestId('drawer-identity-form');
    await expect(form).toBeVisible();

    // Capture the current headline so we can restore it after.
    const headlineField = form.getByTestId('edit-headline');
    const originalHeadline = await headlineField.inputValue();
    const stamp = `E2E-P6-${Date.now()}`;
    const nextHeadline = `${originalHeadline || 'Candidate'} ${stamp}`.slice(0, 200);

    await headlineField.fill(nextHeadline);
    await form.getByTestId('drawer-identity-save').click();

    // Form collapses and headline is reflected in identity card.
    await expect(form).toBeHidden();
    await expect(drawer.getByText(nextHeadline, { exact: false })).toBeVisible();

    // Restore the original value so the suite stays hermetic.
    await drawer.getByTestId('drawer-identity-edit').click();
    const restoreField = drawer.getByTestId('drawer-identity-form').getByTestId('edit-headline');
    await restoreField.fill(originalHeadline);
    await drawer.getByTestId('drawer-identity-form').getByTestId('drawer-identity-save').click();
    await expect(drawer.getByTestId('drawer-identity-form')).toBeHidden();
  });

  test('stage control moves the card to the chosen non-terminal column', async ({ page }) => {
    // The board columns expose their status id via `data-testid="column-<id>"`
    // and their display name via `data-column-name`. Walk the DOM once so
    // we can pick a non-terminal source + target pair for the move.
    const columns = page.locator('[data-testid^="column-"]');
    const total = await columns.count();
    const nonTerminalColumns: Array<{ name: string; id: string }> = [];
    for (let i = 0; i < total; i++) {
      const col = columns.nth(i);
      const name = await col.getAttribute('data-column-name');
      const testid = await col.getAttribute('data-testid');
      if (!name || !testid) continue;
      if (name === 'Dropped' || name === 'Hired') continue;
      nonTerminalColumns.push({ name, id: testid.replace(/^column-/, '') });
    }
    test.skip(nonTerminalColumns.length < 2, 'Need at least 2 non-terminal columns for move test');

    // Pick the first non-terminal column that actually has a card.
    let source: { name: string; id: string } | null = null;
    let cardId: string | null = null;
    for (const col of nonTerminalColumns) {
      const card = page.getByTestId(`column-${col.id}`).getByTestId('kanban-card').first();
      if ((await card.count()) > 0) {
        cardId = await card.getAttribute('data-card-id');
        source = col;
        break;
      }
    }
    test.skip(!source || !cardId, 'No non-terminal column has a candidate to move');

    const target = nonTerminalColumns.find((c) => c.id !== source!.id)!;

    // Open drawer for that card.
    const card = page.locator(`[data-card-id="${cardId}"]`);
    await clickCard(page, card);
    const drawer = page.getByTestId('candidate-drawer');
    await expect(drawer).toBeVisible();

    // Pick the target stage from the dropdown.
    const select = drawer.getByTestId('drawer-stage-select');
    await expect(select).toBeVisible();
    await select.selectOption(target.id);

    // The card should land in the target column, and the drawer badge
    // should reflect the new status.
    await expect(
      page.getByTestId(`column-${target.id}`).locator(`[data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(drawer.getByTestId('drawer-current-status')).toContainText(target.name, {
      timeout: 10_000,
    });

    // Restore: move the card back to its original column.
    const restoreSelect = drawer.getByTestId('drawer-stage-select');
    await restoreSelect.selectOption(source!.id);
    await expect(
      page.getByTestId(`column-${source!.id}`).locator(`[data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 10_000 });
  });
});

/**
 * Click a Kanban card without triggering a drag — same trick as the
 * existing drawer spec. We target the name sub-element so the click is
 * unambiguous against the drag handle.
 */
async function clickCard(page: Page, card: ReturnType<Page['getByTestId']>) {
  await card.getByTestId('kanban-card-name').click({ delay: 0 });
}
