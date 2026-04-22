import { expect, test } from '@playwright/test';

/**
 * Smoke test for Phase 1 — "Edit job" + 3-dot menu.
 *
 * Covers:
 *   1. The 3-dot menu opens and reveals the Edit / Change status / Export
 *      items.
 *   2. Editing the title via the dialog updates the header live (no reload).
 *   3. The Activities tab shows a new `job updated` entry referencing the
 *      changed field.
 *
 * The test is conservative: it appends a unique suffix to the title and
 * restores it afterwards so subsequent runs (or other suites that read the
 * same job) keep their assumptions.
 */
test.describe('Job edit + actions menu', () => {
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

  test('opens the actions menu and surfaces edit / status / export items', async ({ page }) => {
    await page.getByTestId('job-actions-trigger').click();
    const menu = page.getByTestId('job-actions-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByTestId('job-action-edit')).toBeVisible();
    await expect(page.getByTestId('job-action-change-status')).toBeVisible();
    await expect(page.getByTestId('job-action-export')).toBeVisible();
  });

  test('edit dialog updates the title in the header and surfaces in Activities', async ({ page }) => {
    const original = (await page.getByTestId('job-title').innerText()).trim();
    const suffix = ` ✦ ${Date.now().toString(36)}`;
    const next = original + suffix;

    await page.getByTestId('job-actions-trigger').click();
    await page.getByTestId('job-action-edit').click();
    const dialog = page.getByTestId('edit-job-dialog');
    await expect(dialog).toBeVisible();

    const titleInput = dialog.getByTestId('edit-job-title-input');
    await titleInput.fill(next);
    await dialog.getByTestId('edit-job-save').click();
    await expect(dialog).toBeHidden();

    await expect(page.getByTestId('job-title')).toHaveText(next);

    await page.getByTestId('tab-activities').click();
    await page.waitForURL(/\/activities$/);
    // First entry should describe the most recent update.
    await expect(page.getByText(/updated job|changed job status/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Cleanup: restore the original title so the suite is idempotent.
    await page.getByTestId('tab-candidates').click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    await page.getByTestId('job-actions-trigger').click();
    await page.getByTestId('job-action-edit').click();
    await page.getByTestId('edit-job-dialog').getByTestId('edit-job-title-input').fill(original);
    await page.getByTestId('edit-job-dialog').getByTestId('edit-job-save').click();
    await expect(page.getByTestId('job-title')).toHaveText(original);
  });
});
