import { expect, test } from '@playwright/test';

test.describe('registration wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#register').scrollIntoViewIfNeeded();
  });

  test('step 1 shows error for invalid email', async ({ page }) => {
    await page.locator('#fn').fill('Test');
    await page.locator('#ln').fill('User');
    await page.locator('#em').fill('not-an-email');
    await page.getByRole('button', { name: /Add Attendees/i }).click();
    await expect(page.locator('#em-err')).toContainText(/valid/i);
  });

  test('step 4 requires amount and consent before submit', async ({ page }) => {
    await page.locator('#fn').fill('Pat');
    await page.locator('#ln').fill('Lee');
    await page.locator('#em').fill('pat.lee@example.com');
    await page.getByRole('button', { name: /Add Attendees/i }).click();

    await page.locator('#an-1').fill('Pat Lee');
    await page.locator('#aa-1').fill('40');
    await page.getByRole('button', { name: /Review Order/i }).click();
    await page.getByRole('button', { name: /Proceed to Payment/i }).click();

    const completeBtn = page.locator('#complete-btn');
    await expect(completeBtn).toBeVisible();
    await expect(completeBtn).toBeDisabled();

    await page.locator('#reg-pay-amt').fill('0');
    await expect(completeBtn).toBeDisabled();

    await page.locator('#reg-consent').check();
    await expect(completeBtn).toBeEnabled();
  });

  test('paid registration reaches success when E2E_REGISTER=1', async ({ page }) => {
    test.skip(
      process.env.E2E_REGISTER !== '1',
      'Set E2E_REGISTER=1 to exercise POST /api/register',
    );

    const unique = `e2e.${Date.now()}@example.com`;
    await page.locator('#fn').fill('E2E');
    await page.locator('#ln').fill('Playwright');
    await page.locator('#em').fill(unique);
    await page.getByRole('button', { name: /Add Attendees/i }).click();

    await page.locator('#an-1').fill('E2E Playwright');
    await page.locator('#aa-1').fill('40');
    await page.getByRole('button', { name: /Review Order/i }).click();
    await page.getByRole('button', { name: /Proceed to Payment/i }).click();

    await page.locator('#reg-pay-amt').fill('0');
    await page.locator('#reg-consent').check();
    await page.locator('#complete-btn').click();

    await expect(
      page.getByRole('heading', { name: /Registration Confirmed/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#code-display')).not.toBeEmpty();
  });
});
