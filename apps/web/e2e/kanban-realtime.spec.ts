import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Cross-browser realtime sync e2e.
 *
 * Opens two isolated browser contexts (simulating two users / two tabs) both
 * viewing the same job's Kanban board. Context A drags a card; context B
 * should observe the move via Socket.IO (`application.moved` event) without
 * any reload.
 */

async function loginAndOpenFirstJob(page: Page): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');

  // Pin to US account for determinism.
  const switcher = page.getByTestId('account-switcher');
  const usValue = await switcher.locator('option', { hasText: 'Hays US' }).getAttribute('value');
  await switcher.selectOption(usValue!);
  await expect(page.getByTestId('active-region-badge')).toContainText(/US/);

  await page.getByTestId('job-row').first().click();
  await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
  await expect(page.getByTestId('kanban-board')).toBeVisible();
  // Return the job id extracted from URL so both contexts can open the same board.
  const url = page.url();
  const m = url.match(/\/dashboard\/jobs\/([^/?#]+)/);
  if (!m) throw new Error(`could not parse job id from ${url}`);
  return m[1]!;
}

test.describe('Kanban realtime sync (socket.io)', () => {
  test('moving a card in context A appears in context B without reload', async ({ browser }) => {
    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      const jobId = await loginAndOpenFirstJob(pageA);

      // Log into B, switch to same account, navigate directly to the same job.
      await pageB.goto('/login');
      await pageB.getByLabel('Email').fill('demo@openapplicanttracking.local');
      await pageB.getByLabel('Password').fill('demo1234');
      await pageB.getByRole('button', { name: 'Sign in' }).click();
      await pageB.waitForURL('**/dashboard');
      const switcherB = pageB.getByTestId('account-switcher');
      const usValue = await switcherB.locator('option', { hasText: 'Hays US' }).getAttribute('value');
      await switcherB.selectOption(usValue!);
      await expect(pageB.getByTestId('active-region-badge')).toContainText(/US/);
      await pageB.goto(`/dashboard/jobs/${jobId}`);
      await expect(pageB.getByTestId('kanban-board')).toBeVisible();

      // Pick source (first non-empty) and target column indices on A.
      const columnsA = pageA.locator('[data-testid^="column-"]');
      const colCount = await columnsA.count();
      let sourceIdx = -1;
      for (let i = 0; i < colCount; i++) {
        if ((await columnsA.nth(i).getByTestId('kanban-card').count()) > 0) {
          sourceIdx = i;
          break;
        }
      }
      expect(sourceIdx).toBeGreaterThanOrEqual(0);
      const targetIdx = sourceIdx === 0 ? 1 : 0;

      const card = columnsA.nth(sourceIdx).getByTestId('kanban-card').first();
      const cardId = await card.getAttribute('data-card-id');
      expect(cardId).toBeTruthy();

      // Sanity: in B, that same card is in the same source column before the move.
      const columnsB = pageB.locator('[data-testid^="column-"]');
      await expect(columnsB.nth(sourceIdx).locator(`[data-card-id="${cardId}"]`)).toBeVisible();

      // Drag on A.
      const cardBox = await card.boundingBox();
      const targetBox = await columnsA.nth(targetIdx).boundingBox();
      if (!cardBox || !targetBox) throw new Error('missing bounding boxes');
      await pageA.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await pageA.mouse.down();
      await pageA.mouse.move(cardBox.x + cardBox.width / 2 + 5, cardBox.y + cardBox.height / 2 + 5, { steps: 5 });
      await pageA.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
      await pageA.mouse.up();

      // A sees it locally (optimistic).
      await expect(columnsA.nth(targetIdx).locator(`[data-card-id="${cardId}"]`)).toBeVisible({ timeout: 10_000 });

      // B should see it propagate via Socket.IO — no reload.
      await expect(columnsB.nth(targetIdx).locator(`[data-card-id="${cardId}"]`)).toBeVisible({ timeout: 10_000 });
      await expect(columnsB.nth(sourceIdx).locator(`[data-card-id="${cardId}"]`)).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
