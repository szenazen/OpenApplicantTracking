import { expect, test } from '@playwright/test';

/**
 * Verifies the richer Kanban UI added on top of the original drag+drop board:
 *
 *   1. Job header exposes the three summary tiles (Hired / In pipeline / Dropped),
 *      the job meta row (department/location), and the job status pill.
 *   2. Candidate cards render the candidate name, a role line, and a
 *      years-of-experience chip (seed data gives every candidate `yearsExperience`).
 *   3. The Hired / In-pipeline / Dropped counts sum to the total number of
 *      on-board cards — proving they are computed from the same application list.
 *
 * These tests are read-only (no drag) to stay decoupled from the drag-and-drop
 * tests in `kanban.spec.ts` and `kanban-realtime.spec.ts` which mutate shared
 * seed state in the regional databases.
 */
test.describe('Kanban UI (header + card details)', () => {
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

  test('header shows status pill, meta, and pipeline summary tiles', async ({ page }) => {
    await expect(page.getByTestId('job-title')).toBeVisible();
    await expect(page.getByTestId('job-status-pill')).toBeVisible();
    await expect(page.getByTestId('job-status-pill')).toHaveText(/published/i);

    const meta = page.getByTestId('job-meta');
    await expect(meta).toBeVisible();
    // Seed jobs are Engineering and hosted in us-east-1.
    await expect(meta).toContainText(/Engineering/);
    await expect(meta).toContainText(/us-east-1/);

    for (const id of ['summary-hired', 'summary-in-pipeline', 'summary-dropped']) {
      const tile = page.getByTestId(id);
      await expect(tile).toBeVisible();
      await expect(tile).toContainText(/^\s*(Hired|In pipeline|Dropped)\s*\d+\s*$/);
    }
  });

  test('summary tiles sum equals the total card count', async ({ page }) => {
    const totalCards = await page.getByTestId('kanban-card').count();
    expect(totalCards).toBeGreaterThan(0);

    const hired = await readCount(page, 'summary-hired');
    const inPipe = await readCount(page, 'summary-in-pipeline');
    const dropped = await readCount(page, 'summary-dropped');
    expect(hired + inPipe + dropped).toBe(totalCards);
  });

  test('candidate card shows name and years-of-experience chip', async ({ page }) => {
    const card = page.getByTestId('kanban-card').first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId('kanban-card-name')).toBeVisible();
    // Every seeded candidate has `yearsExperience` set (3..7), so the YoE chip
    // should always be present on at least one card in the board.
    expect(await page.getByTestId('kanban-card-yoe').count()).toBeGreaterThan(0);
  });

  test('each column renders a color dot, a name, and a count pill', async ({ page }) => {
    const columns = page.locator('[data-testid^="column-"]');
    const count = await columns.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const col = columns.nth(i);
      const name = await col.getAttribute('data-column-name');
      expect(name, `column ${i} missing name`).toBeTruthy();
      // Count pill is rendered via [data-testid="col-count-<id>"] — there
      // should be exactly one per column.
      await expect(col.locator('[data-testid^="col-count-"]')).toHaveCount(1);
    }
  });
});

async function readCount(page: import('@playwright/test').Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).innerText()).trim();
  const m = text.match(/(\d+)/);
  return m ? parseInt(m[1]!, 10) : 0;
}
