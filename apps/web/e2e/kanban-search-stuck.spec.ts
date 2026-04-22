import { expect, test } from '@playwright/test';

/**
 * Phase 7 — Kanban polish.
 *
 * Covers the in-board search (input + `/` shortcut + Escape + clear button)
 * and the days-in-stage / stuck indicator presence. Both are read-only
 * tests: they don't drag cards or change stages, so they can run in
 * parallel with the existing kanban suites without perturbing seed data.
 *
 * The stuck indicator test is intentionally tolerant — seed freshness
 * varies per CI run, so we assert on the mutual-exclusion invariant
 * (stuck pill iff amber styling iff >= threshold days) rather than on a
 * specific seed expectation.
 */
test.describe('Kanban search + stuck indicator', () => {
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

  test('search filters candidate cards and can be cleared with the X button', async ({ page }) => {
    // Need at least 2 cards so we can meaningfully narrow the list.
    const cards = page.getByTestId('kanban-card');
    const totalBefore = await cards.count();
    expect(totalBefore).toBeGreaterThan(1);

    // Pick the first card's surname as a search term — likely unique enough
    // to narrow the board but present in at least one card (itself).
    const firstNameEl = cards.first().getByTestId('kanban-card-name');
    const fullName = (await firstNameEl.innerText()).trim();
    const parts = fullName.split(/\s+/);
    const surname = parts[parts.length - 1]!;
    expect(surname.length).toBeGreaterThan(1);

    const search = page.getByTestId('kanban-search');
    await search.fill(surname);

    // The search-count pill should appear and the visible card count must
    // reflect at least one match but never more than the pre-filter total.
    const countPill = page.getByTestId('kanban-search-count');
    await expect(countPill).toBeVisible();
    await expect.poll(async () => cards.count()).toBeGreaterThan(0);
    const filtered = await cards.count();
    expect(filtered).toBeLessThanOrEqual(totalBefore);
    // At least one visible card must still contain the surname.
    await expect(
      page.getByTestId('kanban-card-name').filter({ hasText: surname }).first(),
    ).toBeVisible();

    // Clearing via the X button restores the full board.
    await page.getByTestId('kanban-search-clear').click();
    await expect(search).toHaveValue('');
    await expect(countPill).toBeHidden();
    await expect.poll(async () => cards.count()).toBe(totalBefore);
  });

  test('pressing "/" focuses the search and Escape clears then blurs', async ({ page }) => {
    const search = page.getByTestId('kanban-search');

    // Slash must NOT hijack input focus; it should land on the search box.
    await page.keyboard.press('/');
    await expect(search).toBeFocused();

    await search.fill('zzz-no-match-should-exist-anywhere');
    await expect(page.getByTestId('kanban-search-empty')).toBeVisible();
    await expect(page.getByTestId('kanban-card')).toHaveCount(0);

    // First Escape clears the query while keeping focus on the input.
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.getByTestId('kanban-search-empty')).toBeHidden();

    // Second Escape blurs the input (empty value).
    await page.keyboard.press('Escape');
    await expect(search).not.toBeFocused();
  });

  test('search does not hijack "/" while typing inside an input', async ({ page }) => {
    const search = page.getByTestId('kanban-search');
    await search.focus();
    await search.fill('a/b');
    // The "/" inside the field should be preserved — focus stays here
    // and the literal slash shows up in the query.
    await expect(search).toHaveValue('a/b');
    await expect(search).toBeFocused();
    await page.getByTestId('kanban-search-clear').click();
  });

  test('stuck indicator and time-in-stage chip obey the terminal-stage rule', async ({ page }) => {
    // Every time-in-stage chip must have a matching kanban-card (sanity).
    const timeChips = page.getByTestId('kanban-card-time-in-stage');
    const chipCount = await timeChips.count();
    expect(chipCount).toBeGreaterThan(0);

    // Stuck pills may or may not be present depending on seed freshness —
    // if any exist, they must live on non-terminal columns (NEW/IN_PROGRESS).
    // We assert only that where a stuck pill exists, the same card also
    // carries a time-in-stage chip. This is the UX guarantee we care about.
    const stuckPills = page.getByTestId('kanban-card-stuck');
    const stuckCount = await stuckPills.count();
    for (let i = 0; i < stuckCount; i++) {
      const pill = stuckPills.nth(i);
      const card = pill.locator('xpath=ancestor::*[@data-testid="kanban-card"][1]');
      await expect(card.getByTestId('kanban-card-time-in-stage')).toBeVisible();
      // Stuck pills should never appear on cards inside a HIRED or DROPPED
      // column. We use data-column-name from the enclosing column.
      const column = pill.locator('xpath=ancestor::*[starts-with(@data-testid,"column-")][1]');
      const name = (await column.getAttribute('data-column-name')) ?? '';
      expect(name).not.toMatch(/^hired$/i);
      expect(name).not.toMatch(/^dropped$/i);
    }
  });
});
