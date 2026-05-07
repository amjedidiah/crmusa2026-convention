import { expect, test } from '@playwright/test';

test('index loads with main landmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#main-content')).toBeVisible();
});
