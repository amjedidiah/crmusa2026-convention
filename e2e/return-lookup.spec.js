import { expect, test } from '@playwright/test';

test.describe('#return lookup states', () => {
  test('shows the empty state for plain #return', async ({ page }) => {
    await page.goto('/#return');

    await expect(page.locator('#panel-return')).toHaveClass(/on/);
    await expect(page.locator('#lookup-token-empty')).toBeVisible();
    await expect(page.locator('#lookup-token-empty')).toContainText(
      /Open your secure registration link/i,
    );
    await expect(page.locator('#lookup-token-loading')).toBeHidden();
    await expect(page.locator('#lookup-token-err')).toBeHidden();
    await expect(page.locator('#lookup-recovery-block')).toBeVisible();
    await expect(page.locator('#balance-box')).toBeHidden();
    await expect(page.locator('#return-pay-section')).toBeHidden();
  });

  test('shows the loading state while token lookup is pending', async ({
    page,
  }) => {
    let releaseLookup;
    await page.route('**/api/lookup?token=slow', async (route) => {
      await new Promise((resolve) => {
        releaseLookup = resolve;
      });
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid token' }),
      });
    });

    await page.goto('/#return?token=slow');

    await expect(page.locator('#lookup-token-loading')).toBeVisible();
    await expect(page.locator('#lookup-token-empty')).toBeHidden();
    await expect(page.locator('#lookup-token-err')).toBeHidden();
    await expect(page.locator('#lookup-recovery-block')).toBeHidden();
    await expect(page.locator('#balance-box')).toBeHidden();
    await expect(page.locator('#return-pay-section')).toBeHidden();

    releaseLookup();
  });

  test('shows the error state for an invalid or expired token', async ({
    page,
  }) => {
    await page.route('**/api/lookup?token=bad', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid token' }),
      });
    });

    await page.goto('/#return?token=bad');

    await expect(page.locator('#lookup-token-loading')).toBeHidden();
    await expect(page.locator('#lookup-token-empty')).toBeHidden();
    await expect(page.locator('#lookup-token-err')).toBeVisible();
    await expect(page.locator('#lookup-token-err')).toContainText(
      /invalid, expired, or has been replaced/i,
    );
    await expect(page.locator('#lookup-recovery-block')).toBeVisible();
    await expect(page.locator('#balance-box')).toBeHidden();
    await expect(page.locator('#return-pay-section')).toBeHidden();
  });

  test('shows the success state with registration details for a valid token', async ({
    page,
  }) => {
    await page.route('**/api/lookup?token=good', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          registration: {
            first_name: 'Jane',
            last_name: 'Doe',
            tier: 'regular',
            pledge_code: 'ABCD1234',
            total_cents: 25000,
            amount_paid_cents: 10000,
            remaining_cents: 15000,
          },
        }),
      });
    });

    await page.goto('/#return?token=good');

    await expect(page.locator('#lookup-token-loading')).toBeHidden();
    await expect(page.locator('#lookup-token-empty')).toBeHidden();
    await expect(page.locator('#lookup-token-err')).toBeHidden();
    await expect(page.locator('#lookup-recovery-block')).toBeHidden();
    await expect(page.locator('#balance-box')).toBeVisible();
    await expect(page.locator('#return-pay-section')).toBeVisible();
    await expect(page.locator('#bal-name')).toHaveText('Jane Doe');
    await expect(page.locator('#bal-remaining')).toHaveText('$150.00');
    await expect(page).toHaveURL(/#return$/);
  });
});
