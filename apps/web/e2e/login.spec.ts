import { expect, test } from '@playwright/test';

/**
 * Smoke-level e2e:
 *   1. /login loads.
 *   2. Signing in as the seeded demo user lands on /dashboard with the 3 Hays accounts visible in the switcher.
 *   3. Switching between US and EU accounts refreshes the jobs list (and the active-region badge).
 *   4. Signing out clears auth + returns to /login.
 */
test.describe('Auth + account switcher', () => {
  test('login → dashboard → switch account → sign out', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Demo credentials are prefilled, but submit explicitly.
    await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL('**/dashboard');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recruiter home' })).toBeVisible();

    // Account switcher should have all 3 Hays accounts.
    const switcher = page.getByTestId('account-switcher');
    const optionLabels = await switcher.locator('option').allTextContents();
    expect(optionLabels.length).toBeGreaterThanOrEqual(3);
    expect(optionLabels.join('|')).toMatch(/Hays US/);
    expect(optionLabels.join('|')).toMatch(/Hays EU/);
    expect(optionLabels.join('|')).toMatch(/Hays Singapore/);

    // Seeded data: each account has exactly 2 jobs.
    await expect(page.getByTestId('job-row')).toHaveCount(2);

    // Snapshot the first job title under the current (default) account.
    const firstTitleUS = await page.getByTestId('job-row').first().locator('div.font-medium').textContent();
    expect(firstTitleUS).toContain('us-east-1');

    // Switch to Hays EU. Native <select> doesn't accept regex labels, so look up the value.
    const euValue = await switcher.locator('option', { hasText: 'Hays EU' }).getAttribute('value');
    expect(euValue).toBeTruthy();
    await switcher.selectOption(euValue!);
    // Jobs list should re-fetch and show EU-region jobs.
    await expect(page.locator('[data-testid="job-row"] >> text=eu-west-1').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('active-region-badge')).toContainText(/EU/);

    // Switch to Hays Singapore.
    const sgValue = await switcher.locator('option', { hasText: 'Hays Singapore' }).getAttribute('value');
    expect(sgValue).toBeTruthy();
    await switcher.selectOption(sgValue!);
    await expect(page.locator('[data-testid="job-row"] >> text=ap-southeast-1').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('active-region-badge')).toContainText(/Singapore/);

    // Sign out.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@openapplicanttracking.local');
    await page.getByLabel('Password').fill('nope-nope-nope');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
