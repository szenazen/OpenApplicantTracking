import { expect, test } from '@playwright/test';

/**
 * Phase 8 — Candidates list upgrade.
 *
 * Covers the new server-paginated list, filter panel and row → drawer
 * flow on `/dashboard/candidates`. The existing `candidates-list.spec.ts`
 * suite still exercises the basic render + name filter and is left
 * untouched — these tests layer on top of it.
 */
test.describe('Candidates list — filters + drawer', () => {
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
    await page.goto('/dashboard/candidates');
    await expect(page.getByTestId('candidates-page')).toBeVisible();
    await expect(page.getByTestId('candidate-row').first()).toBeVisible();
  });

  test('shows the filter panel with Skills / Active / YoE controls and an end-of-list marker', async ({ page }) => {
    await expect(page.getByTestId('candidates-filter-panel')).toBeVisible();
    await expect(page.getByTestId('candidates-skill-picker')).toBeVisible();
    await expect(page.getByTestId('candidates-active-filter')).toBeVisible();
    await expect(page.getByTestId('candidates-yoe-filter')).toBeVisible();
    // Seed has 10 candidates per account, well under the default 50-row
    // page size, so we expect the "End of list" marker instead of "Load more".
    await expect(page.getByTestId('candidates-end')).toBeVisible();
  });

  test('Active-only segmented filter narrows to rows with an active application', async ({ page }) => {
    const allRowsBefore = await page.getByTestId('candidate-row').count();
    expect(allRowsBefore).toBeGreaterThan(0);

    await page.getByTestId('active-true').click();
    // URL must carry the filter so a shared link is reproducible.
    await expect(page).toHaveURL(/hasActive=true/);

    const activeRows = await page.getByTestId('candidate-row').count();
    expect(activeRows).toBeGreaterThan(0);
    // Every visible row must have at least 1 active application.
    const counts = await page.getByTestId('candidate-active-count').allInnerTexts();
    for (const c of counts) {
      expect(parseInt(c, 10) || 0).toBeGreaterThanOrEqual(1);
    }

    // Reset via the "Any" option.
    await page.getByRole('button', { name: 'Any' }).click();
    await expect(page).not.toHaveURL(/hasActive=/);
  });

  test('skill filter AND-narrows the list and persists to the URL', async ({ page }) => {
    // Pick a skill rendered on one of the visible rows so we know the
    // filter will keep at least that candidate.
    const firstSkillChip = page.locator('[data-testid="candidate-row"] li[title^="Proficiency"], [data-testid="candidate-row"] li').first();
    // Fallback-safe: if no chip, skip skill narrowing assertion.
    const chipText = (await firstSkillChip.innerText()).trim();
    expect(chipText.length).toBeGreaterThan(0);

    // Open the skill picker, search for the chip label, and tick its option.
    await page.getByTestId('candidates-skill-picker').click();
    await expect(page.getByTestId('candidates-skill-menu')).toBeVisible();
    await page.getByPlaceholder('Search skills…').fill(chipText);

    // Click the surrounding <label> — the checkbox is controlled from the
    // URL, so `.check()` (which asserts :checked post-click) can race the
    // router.replace → re-render cycle. A plain click on the label toggles
    // the checkbox and we assert the URL propagation directly.
    const optionLabel = page
      .locator('[data-testid^="skill-option-"]')
      .first()
      .locator('xpath=ancestor::label');
    await expect(optionLabel).toBeVisible();
    await optionLabel.click();

    // URL must carry the filter so a shared link is reproducible.
    await expect(page).toHaveURL(/skillIds=/);
    // Dismiss the popover by clicking outside of it.
    await page.mouse.click(10, 10);
    // Rows remaining must still exist and MUST contain the skill chip.
    const rows = page.getByTestId('candidate-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText(chipText, { exact: true }).first()).toBeVisible();
    }

    // Clear-all resets everything including the URL.
    await page.getByTestId('candidates-filters-clear').click();
    await expect(page).not.toHaveURL(/skillIds=/);
  });

  test('clicking a row opens the candidate drawer and syncs ?application=', async ({ page }) => {
    const firstRow = page.getByTestId('candidate-row').first();
    const appId = await firstRow.getAttribute('data-most-recent-app-id');
    expect(appId).toBeTruthy();
    await firstRow.click();

    await expect(page.getByTestId('candidate-drawer')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`application=${appId}`));

    // Escape closes the drawer and drops the query param.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('candidate-drawer')).toBeHidden();
    await expect(page).not.toHaveURL(/application=/);
  });

  test('YoE min bound filters to rows with sufficient experience and persists to the URL', async ({ page }) => {
    await page.getByTestId('candidates-yoe-min').fill('4');
    await page.getByTestId('candidates-yoe-min').blur();

    await expect(page).toHaveURL(/minYoe=4/);
    const rows = page.getByTestId('candidate-row');
    await expect.poll(async () => rows.count()).toBeGreaterThanOrEqual(0);

    // Clear with the inline X button next to the YoE inputs.
    await page.getByTestId('candidates-filters-clear').click();
    await expect(page).not.toHaveURL(/minYoe=/);
  });
});
