import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

test('ZIP is exact and radius searches use stored coordinates and resolved addresses', async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-search-area-e2e-'));
  const databasePath = join(root, 'ledgerline.sqlite');
  let api: Api | undefined;
  try {
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    const zipResponse = await fetch(
      api.url('/api/listings?mode=sale&locationMode=zip&location=33308'),
    );
    const zipData = (await zipResponse.json()) as {
      items: Array<{ property: { zip: string; city: string } }>;
    };
    expect(zipResponse.ok).toBe(true);
    expect(zipData.items.length).toBeGreaterThan(0);
    expect(zipData.items.every((item) => item.property.zip === '33308')).toBe(true);

    const center = new URLSearchParams({
      mode: 'sale',
      locationMode: 'radius',
      radiusMi: '0.1',
      centerLat: '26.19',
      centerLng: '-80.115',
    });
    const closeResponse = await fetch(api.url(`/api/listings?${center}`));
    const closeData = (await closeResponse.json()) as {
      items: Array<{
        property: { city: string; latitude: number | null; longitude: number | null };
      }>;
    };
    expect(closeResponse.ok).toBe(true);
    expect(closeData.items.map((item) => item.property.city)).toEqual(['Fort Lauderdale']);

    center.set('radiusMi', '25.0');
    const wideResponse = await fetch(api.url(`/api/listings?${center}`));
    const wideData = (await wideResponse.json()) as {
      items: Array<{ property: { city: string } }>;
    };
    expect(wideData.items.some((item) => item.property.city === 'Boca Raton')).toBe(true);
    expect(wideData.items.some((item) => item.property.city === 'Brickell')).toBe(false);

    const unresolved = await fetch(
      api.url('/api/search-center?address=1%20Unknown%20Way%2C%20Miami%2C%20FL%2033311'),
    );
    expect(await unresolved.json()).toMatchObject({ status: 'unresolved' });
    await routeApiTo(page, () => api!);
    await page.goto('/');
    await page.getByLabel('Location search type').selectOption('zip');
    await page.getByLabel('ZIP code').fill('33308');
    await expect(page.getByRole('button', { name: 'Remove ZIP 33308' })).toBeVisible();
    await expect(page.locator('.listing-card')).toHaveCount(zipData.items.length);

    await page.getByLabel('Location search type').selectOption('radius');
    await page.getByLabel('Radius center type').selectOption('address');
    await page
      .getByLabel('Radius street address')
      .fill('2207 N.E. 32nd Court, Fort Lauderdale, FL 33308');
    await page.getByLabel('Radius in miles').fill('25.0');
    await expect(page.getByText('Resolved point · 26.19, -80.115')).toBeVisible();
    await expect(page.getByRole('button', { name: /Within 25 mi of/ })).toBeVisible();
    await expect(page).toHaveURL(/locationMode=radius/);
    await expect(page.locator('.search-radius-circle')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Radius in miles')).toHaveValue('25.0');
    await expect(page.getByText('Resolved point · 26.19, -80.115')).toBeVisible();
    await page.getByRole('button', { name: 'Save current search' }).click();
    await page.getByLabel('Saved search name').fill('Fort Lauderdale radius');
    await page.getByRole('button', { name: 'Save search' }).click();
    await page.reload();
    const savedSearch = page.getByLabel('Open saved search');
    await expect(savedSearch.locator('option', { hasText: 'Fort Lauderdale radius' })).toHaveCount(
      1,
    );
    const savedOption = savedSearch.locator('option', { hasText: 'Fort Lauderdale radius' });
    await savedSearch.selectOption((await savedOption.getAttribute('value'))!);
    await expect(page.getByLabel('Radius in miles')).toHaveValue('25');
    await expect(page.getByLabel('Radius street address')).toHaveValue(
      '2207 N.E. 32nd Court, Fort Lauderdale, FL 33308',
    );
    await page.goto('/settings#saved-searches');
    const radiusRow = page
      .locator('.saved-search-row')
      .filter({ hasText: 'Fort Lauderdale radius' });
    await expect(radiusRow).toContainText('Radius refresh supported by mock.');
    await radiusRow.getByRole('button', { name: 'Add Rent search' }).click();
    await expect(radiusRow).toContainText('Paired Rent search on');
    await page.goto('/');
    const pairedRadiusRent = await page.evaluate(async () => {
      const response = await fetch('/api/saved-searches');
      const result = (await response.json()) as {
        items: Array<{
          id: number;
          mode: string;
          locationMode: string;
          centerAddress: string | null;
          centerLatitude: number | null;
          centerLongitude: number | null;
          radiusMi: number | null;
        }>;
      };
      return result.items.find((item) => item.mode === 'rent' && item.locationMode === 'radius');
    });
    expect(pairedRadiusRent).toMatchObject({
      centerAddress: '2207 N.E. 32nd Court, Fort Lauderdale, FL 33308',
      centerLatitude: 26.19,
      centerLongitude: -80.115,
      radiusMi: 25,
    });
    await page.getByLabel('Open saved search').selectOption(String(pairedRadiusRent!.id));
    await expect(page.getByLabel('Radius in miles')).toHaveValue('25');
    await expect(page.getByLabel('Radius street address')).toHaveValue(
      '2207 N.E. 32nd Court, Fort Lauderdale, FL 33308',
    );
  } finally {
    if (api) await api.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid ZIP, radius, and coordinates are inline errors and call no listing search', async ({
  page,
}) => {
  let listingRequests = 0;
  await page.route('**/api/listings?**', async (route) => {
    listingRequests += 1;
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/listings/capabilities', (route) =>
    route.fulfill({ json: { waterfront: false } }),
  );
  await page.goto('/');
  await expect(page.getByLabel('Location search type')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const initialListingRequests = listingRequests;
  await page.getByLabel('Location search type').selectOption('zip');
  await page.getByLabel('ZIP code').fill('123');
  await expect(page.getByText('Enter a five-digit ZIP code.')).toBeVisible();
  await page.getByLabel('Location search type').selectOption('radius');
  await page.getByLabel('Radius center type').selectOption('coordinates');
  await page.getByLabel('Center latitude').fill('91');
  await page.getByLabel('Center longitude').fill('-80');
  await page.getByLabel('Radius in miles').fill('25.1');
  await expect(page.getByText('Radius must be from 0.1 to 25.0 miles.')).toBeVisible();
  await expect(page.getByText('Latitude must be between -90 and 90.')).toBeVisible();
  expect(listingRequests).toBe(initialListingRequests);
});
