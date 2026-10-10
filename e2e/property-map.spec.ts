import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

let root: string;
let api: Api;
let propertyId: string;
let location: { latitude: number; longitude: number };

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-property-map-'));
  const databasePath = join(root, 'ledgerline.sqlite');
  seedDatabase(databasePath);
  api = await startApi(databasePath);
  const response = await fetch(api.url('/api/listings?mode=sale'));
  const listings = (await response.json()) as {
    items: Array<{
      property: { id: string; street: string; latitude: number; longitude: number };
    }>;
  };
  const found = listings.items.find((item) => item.property.street === '2207 NE 32nd Ct')!;
  propertyId = found.property.id;
  location = { latitude: found.property.latitude, longitude: found.property.longitude };
});

test.afterAll(async () => {
  await api?.stop();
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await routeApiTo(page, () => api);
});

test('keyed property page loads one map and pin, with Street View above it', async ({ page }) => {
  let mapsScripts = 0;
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    if (/rentcast|\/api\/(?:refresh|rent-estimate)/i.test(request.url())) {
      providerRequests.push(request.url());
    }
  });
  await page.route('**/api/google-maps-key', (route) =>
    route.fulfill({ json: { key: 'fake-maps-key' } }),
  );
  await page.route('https://maps.googleapis.com/maps/api/js?**', (route) => {
    mapsScripts += 1;
    return route.fulfill({
      contentType: 'text/javascript',
      body: `
        window.__propertyMaps = { maps: [], markers: [] };
        window.google = { maps: {
          Map: class {
            constructor(element, options) { window.__propertyMaps.maps.push({ element, options }); }
          },
          Marker: class {
            constructor(options) { window.__propertyMaps.markers.push(options); }
            setMap() {}
          }
        } };
        window.__ledgerlineMapsReady();
      `,
    });
  });

  await page.goto(`/property/${propertyId}`);
  const link = page.getByRole('link', { name: 'Open Street View' });
  await expect(link).toHaveAttribute(
    'href',
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${location.latitude},${location.longitude}`,
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByLabel('Google map of 2207 NE 32nd Ct, Fort Lauderdale')).toBeVisible();
  const order = await page.evaluate(() => {
    const link = document.querySelector('.property-street-view')!;
    const map = document.querySelector('.property-map-panel')!;
    return Boolean(link.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  const expectedPosition = { lat: location.latitude, lng: location.longitude };
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as unknown as {
            __propertyMaps?: {
              maps: Array<{ options: { center: { lat: number; lng: number } } }>;
              markers: Array<{ position: { lat: number; lng: number } }>;
            };
          }
        ).__propertyMaps;
        return {
          centers: calls?.maps.map(({ options }) => options.center) ?? [],
          pins: calls?.markers.map(({ position }) => position) ?? [],
        };
      }),
    )
    .toEqual({ centers: [expectedPosition], pins: [expectedPosition] });
  expect(mapsScripts).toBe(1);
  expect(providerRequests).toEqual([]);
  await expect(page.locator('img[src*="streetview"], iframe[src*="streetview"]')).toHaveCount(0);
});

test('without a key, the local map shows the stored pin and Settings prompt', async ({ page }) => {
  let googleRequests = 0;
  await page.route('**/api/google-maps-key', (route) => route.fulfill({ json: { key: null } }));
  await page.route('https://maps.googleapis.com/**', (route) => {
    googleRequests += 1;
    return route.abort();
  });
  await page.goto(`/property/${propertyId}`);
  await expect(page.getByRole('img', { name: /Local map showing 2207 NE 32nd Ct/ })).toBeVisible();
  await expect(page.locator('.property-map-pin')).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: 'Add a Google Maps key in Settings' }),
  ).toHaveAttribute('href', '/settings#keys');
  await expect(page.locator('.property-map-panel .county-shape')).toHaveCount(3);
  expect(googleRequests).toBe(0);
});

test('a failed Google script falls back to the local property pin', async ({ page }) => {
  await page.route('**/api/google-maps-key', (route) =>
    route.fulfill({ json: { key: 'fake-maps-key' } }),
  );
  await page.route('https://maps.googleapis.com/maps/api/js?**', (route) => route.abort());
  await page.goto(`/property/${propertyId}`);
  await expect(page.locator('.property-map-pin')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Add a Google Maps key in Settings' })).toBeVisible();
});

test('without coordinates, the page shows a plain message and no map or Street View link', async ({
  page,
}) => {
  await page.route(`**/api/properties/${propertyId}`, async (route) => {
    const response = await route.fetch({ url: api.url(`/api/properties/${propertyId}`) });
    const body = await response.json();
    body.property.latitude = null;
    body.property.longitude = null;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/property/${propertyId}`);
  await expect(page.getByText('Map unavailable: this property has no coordinates.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Street View' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Property map' })).toHaveCount(0);
});
