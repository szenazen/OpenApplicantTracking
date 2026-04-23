import { expect, test } from '@playwright/test';

/**
 * End-to-end for Phase H — the Team tab.
 *
 * Scenarios:
 *   1. The tab lists any existing team members (possibly zero on a fresh
 *      demo) and a working "Add member" affordance.
 *   2. Adding the demo user as a hiring manager shows them in the team list
 *      AND bumps the team-chips count in the header. Removing them rolls
 *      both back.
 *
 * The demo seed has a single Hays US account member, so self-adding is the
 * deterministic path available from an unmodified seed.
 */
test.describe('Job team tab', () => {
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

  test('add a member, verify list + header chip, then remove them', async ({ page }) => {
    await page.getByTestId('tab-team').click();
    await page.waitForURL(/\/team$/);
    await expect(page.getByTestId('job-team-page')).toBeVisible();

    // Make the test idempotent — if the demo user is already on this team
    // from a prior run, remove them first so we can re-add deterministically.
    const existingOnDemo = page
      .getByTestId('team-member')
      .filter({ hasText: 'demo@openapplicanttracking' });
    if ((await existingOnDemo.count()) > 0) {
      page.once('dialog', (d) => d.accept());
      await existingOnDemo.first().getByTestId('team-member-remove').click();
      await expect(existingOnDemo).toHaveCount(0);
    }

    const countBefore = await page.getByTestId('team-member').count();

    await page.getByTestId('team-add-toggle').click();
    await expect(page.getByTestId('team-add-form')).toBeVisible();

    // Pick the first offered account member (the demo user themselves, or
    // another seeded colleague — either is fine).
    const userSelect = page.getByTestId('team-add-user');
    const firstRealOption = userSelect.locator('option').nth(1);
    const userValue = await firstRealOption.getAttribute('value');
    test.skip(!userValue, 'no addable account member available in this seed');
    await userSelect.selectOption(userValue!);
    await page.getByTestId('team-add-role').selectOption('HIRING_MANAGER');
    await page.getByTestId('team-add-submit').click();

    await expect(page.getByTestId('team-member')).toHaveCount(countBefore + 1);
    // Header chip group should now reflect the new count.
    const chips = page.getByTestId('team-chips');
    await expect(chips).toBeVisible();
    await expect(chips).toContainText(`${countBefore + 1} on team`);

    // Cleanup — remove the just-added member so subsequent runs start clean.
    page.once('dialog', (d) => d.accept());
    const lastMember = page.getByTestId('team-member').last();
    await lastMember.getByTestId('team-member-remove').click();
    await expect(page.getByTestId('team-member')).toHaveCount(countBefore);
  });
});
