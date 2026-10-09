import { expect, test } from '@playwright/test';

test('sets a RentCast key through the local API and displays only Key set', async ({ page }) => {
  const secret = 'fake-rentcast-key-for-browser-test';
  let stored = false;
  let submitted = '';
  await page.route('**/api/provider-credentials', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { configured: stored } });
    }
    submitted = (route.request().postDataJSON() as { rentCastApiKey: string }).rentCastApiKey;
    stored = true;
    return route.fulfill({ json: { configured: true } });
  });

  await page.goto('/settings');
  await page.getByLabel('RentCast API key').fill(secret);
  await page.getByRole('button', { name: 'Set key' }).click();

  await expect(page.getByText('Key set')).toBeVisible();
  await expect(page.getByLabel('RentCast API key')).toHaveCount(0);
  expect(submitted).toBe(secret);
  await expect(page.locator('body')).not.toContainText(secret);
});
