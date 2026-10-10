import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p0cAAAAASUVORK5CYII=',
  'base64',
);

test('property photos upload, persist across API restart, show on cards, and can be removed', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-photos-'));
  const databasePath = join(directory, 'ledgerline.sqlite');
  let api: Api | null = null;
  try {
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    let currentApi = api;
    await routeApiTo(page, () => currentApi);
    const listings = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
      items: Array<{ property: { id: string } }>;
    };
    const propertyId = listings.items[0]!.property.id;
    await page.goto(`/property/${propertyId}`);
    await expect(page.getByText('No photos yet · Add photos')).toBeVisible();
    const input = page.getByLabel('Add photos');
    await input.setInputFiles([
      { name: 'front.png', mimeType: 'image/png', buffer: tinyPng },
      { name: 'kitchen.png', mimeType: 'image/png', buffer: tinyPng },
    ]);
    await expect(page.locator('.property-photo-grid img')).toHaveCount(2);
    await expect(page.getByRole('status').filter({ hasText: '2 photos added.' })).toBeVisible();

    await page.goto('/');
    await expect(page.locator('article.listing-card img')).toHaveCount(1);

    await currentApi.stop();
    api = await startApi(databasePath);
    currentApi = api;
    await page.goto(`/property/${propertyId}`);
    await expect(page.locator('.property-photo-grid img')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remove photo' }).first().click();
    await expect(page.locator('.property-photo-grid img')).toHaveCount(1);
    await page.goto('/');
    await expect(page.locator('article.listing-card img')).toHaveCount(1);
  } finally {
    if (api) await api.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
