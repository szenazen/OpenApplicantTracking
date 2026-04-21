import { expect, test } from '@playwright/test';

/**
 * End-to-end for Phase E — the Notes tab on a job.
 *
 * Scenarios:
 *   1. Navigate to the Notes tab, compose a note, see it appear in the list
 *      with the correct author.
 *   2. Editing a note by its author updates the body and marks it "(edited)".
 *   3. Deleting the note removes it from the list.
 *
 * The tests each create a uniquely-bodied note (suffix with test id) so
 * parallel / repeated runs don't interfere with each other.
 */
test.describe('Job notes', () => {
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
    await page.getByTestId('tab-notes').click();
    await page.waitForURL(/\/notes$/);
    await expect(page.getByTestId('job-notes-page')).toBeVisible();
  });

  test('can post a note and see it in the list', async ({ page }) => {
    const body = `Playwright note ${Date.now()}`;
    await page.getByTestId('note-compose').fill(body);
    await page.getByTestId('note-submit').click();

    const list = page.getByTestId('note-list');
    await expect(list).toBeVisible();
    const firstItem = list.getByTestId('note-item').first();
    await expect(firstItem).toContainText(body);
    // Our logged-in user is "Demo Recruiter" — the author label should match.
    await expect(firstItem).toContainText(/Demo Recruiter|demo@openapplicanttracking/i);
  });

  test('author can edit a note and the body updates', async ({ page }) => {
    const original = `Edit-me note ${Date.now()}`;
    await page.getByTestId('note-compose').fill(original);
    await page.getByTestId('note-submit').click();

    const first = page.getByTestId('note-list').getByTestId('note-item').first();
    await expect(first).toContainText(original);

    await first.getByTestId('note-edit').click();
    const updated = `${original} (updated)`;
    await first.getByTestId('note-edit-input').fill(updated);
    await first.getByTestId('note-save').click();

    await expect(first.getByTestId('note-body')).toHaveText(updated);
    await expect(first).toContainText(/\(edited\)/);
  });

  test('author can delete a note and it disappears from the list', async ({ page }) => {
    // Install the dialog handler up front — confirm() fires before we can
    // `page.once()` if we register right at the click site.
    page.on('dialog', (d) => d.accept());

    const body = `Delete-me note ${Date.now()}`;
    await page.getByTestId('note-compose').fill(body);
    await page.getByTestId('note-submit').click();

    const item = page.locator('[data-testid="note-item"]', { hasText: body });
    await expect(item).toHaveCount(1);

    await item.getByTestId('note-delete').click();
    await expect(item).toHaveCount(0);
  });
});
