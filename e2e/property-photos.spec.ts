import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p0cAAAAASUVORK5CYII=',
  'base64',
);

test('property photos upload, persist across API restart, show as the primary photo, and can be removed', async ({
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
    await expect(page.locator('.property-detail-primary-photo')).toHaveCount(0);
    const input = page.getByLabel('Add photos');
    await input.setInputFiles([
      { name: 'front.png', mimeType: 'image/png', buffer: tinyPng },
      { name: 'kitchen.png', mimeType: 'image/png', buffer: tinyPng },
    ]);
    await expect(page.locator('.property-photo-grid img')).toHaveCount(2);
    const firstPhoto = page.locator('.property-photo-grid img').first();
    const firstPhotoUrl = await firstPhoto.getAttribute('src');
    const headerPhoto = page.locator('.property-detail-primary-photo');
    await expect(headerPhoto).toHaveAttribute('src', firstPhotoUrl!);
    await expect(headerPhoto).toHaveAttribute('alt', /primary photo/);
    await expect(page.getByRole('status').filter({ hasText: '2 photos added.' })).toBeVisible();

    await page.goto('/?mode=sale');
    await expect(page.locator('article.listing-card img')).toHaveCount(1);

    await currentApi.stop();
    api = await startApi(databasePath);
    currentApi = api;
    await page.goto(`/property/${propertyId}`);
    await expect(page.locator('.property-photo-grid img')).toHaveCount(2);
    await expect(page.locator('.property-detail-primary-photo')).toHaveAttribute(
      'src',
      firstPhotoUrl!,
    );
    await page.getByRole('button', { name: 'Remove photo' }).first().click();
    await expect(page.locator('.property-photo-grid img')).toHaveCount(1);
    await expect(page.locator('.property-detail-primary-photo')).toHaveAttribute(
      'src',
      await page.locator('.property-photo-grid img').first().getAttribute('src')!,
    );
    await page.goto('/?mode=sale');
    await expect(page.locator('article.listing-card img')).toHaveCount(1);
  } finally {
    if (api) await api.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('photo viewer opens from property, Search, and Compare with keyboard and focus support', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-photo-viewer-'));
  const databasePath = join(directory, 'ledgerline.sqlite');
  let api: Api | null = null;
  try {
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    await routeApiTo(page, () => api!);
    const listings = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
      items: Array<{ property: { id: string; street: string } }>;
    };
    const property = listings.items[0]!.property;
    const uploaded: Array<{ id: string; path: string }> = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(api.url(`/api/properties/${property.id}/photos`), {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'x-photo-source': 'Uploaded by me',
        },
        body: tinyPng,
      });
      expect(response.ok).toBeTruthy();
      const result = (await response.json()) as { photo: { id: string; path: string } };
      uploaded.push(result.photo);
    }
    unlinkSync(join(directory, 'photos', uploaded[1]!.path));

    await page.goto(`/property/${property.id}`);
    const propertyThumbnail = page.getByRole('button', { name: /View photo 1 of 3/ });
    await propertyThumbnail.click();
    const dialog = page.getByRole('dialog', { name: 'Property photo viewer' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Photo 1 of 3')).toBeVisible();
    await expect(dialog.getByText(/Uploaded by me ·/)).toBeVisible();
    await expect(dialog.locator('img')).toHaveAttribute('alt', `${property.street} property photo`);
    const axe = await new AxeBuilder({ page }).include('.photo-viewer-dialog').analyze();
    expect(axe.violations).toEqual([]);

    const close = dialog.getByRole('button', { name: 'Close photo viewer' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Next photo' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('Photo 3 of 3')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByText('Photo 1 of 3')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(propertyThumbnail).toBeFocused();

    await page.goto('/?mode=sale');
    const card = page.locator('.listing-card:has(.listing-card-photo-button)').first();
    const cardPhoto = card.locator('.listing-card-photo-button');
    await expect(card).toHaveClass(/is-selected/);
    const initialRank = await card.locator('.ranking-summary').textContent();
    const selectedBefore = await card.getAttribute('class');
    await cardPhoto.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(card).toHaveAttribute('class', selectedBefore!);
    await expect(card.locator('.ranking-summary')).toHaveText(initialRank!);
    await page.getByRole('button', { name: 'Close photo viewer' }).click();
    await expect(cardPhoto).toBeFocused();

    await page.goto(`/property/${property.id}`);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.goto('/compare');
    const comparePhoto = page.locator('.compare-property-photo-button').first();
    await expect(comparePhoto).toBeVisible();
    await comparePhoto.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Photo 1 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Close photo viewer' }).click();
    await expect(comparePhoto).toBeFocused();

    await fetch(api.url(`/api/properties/${property.id}/photos/${uploaded[2]!.id}`), {
      method: 'DELETE',
    });
    await page.goto(`/property/${property.id}`);
    const onePhoto = page.getByRole('button', { name: /View photo 1 of 2/ });
    await onePhoto.click();
    const onePhotoDialog = page.getByRole('dialog');
    await expect(onePhotoDialog.getByText('Photo 1 of 2')).toBeVisible();
    await expect(onePhotoDialog.getByRole('button', { name: 'Previous photo' })).toHaveCount(0);
    await expect(onePhotoDialog.getByRole('button', { name: 'Next photo' })).toHaveCount(0);
  } finally {
    if (api) await api.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
