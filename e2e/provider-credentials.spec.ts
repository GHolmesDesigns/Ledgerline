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

  await expect(page.getByRole('region', { name: 'Keys' }).locator('strong')).toHaveText('Key set');
  await expect(page.getByLabel('RentCast API key')).toHaveCount(0);
  expect(submitted).toBe(secret);
  await expect(page.locator('body')).not.toContainText(secret);
});

test('sets a Google Maps key in Settings without displaying its value', async ({ page }) => {
  const secret = 'fake-google-key-for-browser-test';
  let stored = false;
  await page.route('**/api/provider-credentials', (route) =>
    route.fulfill({ json: { configured: false, googleMapsConfigured: stored } }),
  );
  await page.route('**/api/google-maps-key', (route) => {
    expect((route.request().postDataJSON() as { googleMapsApiKey: string }).googleMapsApiKey).toBe(
      secret,
    );
    stored = true;
    return route.fulfill({ json: { configured: true } });
  });
  await page.goto('/settings#keys');
  await page.getByLabel('Google Maps API key').fill(secret);
  await page.getByRole('button', { name: 'Set Google Maps key' }).click();
  await expect(page.getByRole('button', { name: 'Replace Google Maps key' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(secret);
});
