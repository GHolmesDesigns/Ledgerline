import { expect, test } from '@playwright/test';

const results = [
  ['sale-ftl', '2207 NE 32nd Ct', 'Fort Lauderdale', 849000],
  ['sale-miami', '3250 NE 2nd Ave', 'Miami', 285000],
  ['sale-boca', '618 NE 7th St', 'Boca Raton', 615000],
].map(([id, street, city, price]) => ({
  property: {
    id,
    street,
    unit: null,
    city,
    zip: '33308',
    county: city === 'Boca Raton' ? 'Palm Beach' : city === 'Miami' ? 'Miami-Dade' : 'Broward',
    propertyType: 'single_family',
    beds: 3,
    bathsTotal: 2,
    livingAreaSqft: 1850,
    yearBuilt: 1964,
    latitude: null,
    longitude: null,
  },
  listing: {
    id,
    mode: 'sale',
    price,
    pricePeriod: 'total',
    status: 'active',
    provider: 'mock',
    providerLastSeenDate: '2026-10-06',
  },
}));

test('pins and listing cards stay synchronized, and local map actions make no provider calls', async ({
  page,
}) => {
  let searchRequests = 0;
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { items: results } });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Results near South Florida' })).toBeVisible();
  await expect(page.locator('.county-shape')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /map pin 1 of 3/i })).toHaveCount(1);

  const miamiPin = page.getByRole('button', { name: /3250 NE 2nd Ave, Miami.*map pin/i });
  await miamiPin.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#listing-sale-miami')).toHaveClass(/is-selected/);
  await expect(page.getByRole('button', { name: 'Select 2207 NE 32nd Ct on map' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Select 618 NE 7th St on map' }).click();
  await expect(
    page.getByRole('button', { name: /618 NE 7th St, Boca Raton.*map pin/i }),
  ).toHaveAttribute('aria-pressed', 'true');

  const requestCount = searchRequests;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(searchRequests).toBe(requestCount);
});

test('mobile Map view shows a selected listing card and a List/Map toggle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: results } }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('.map-selected-card')).toContainText('$849,000');
  await expect(page.getByRole('link', { name: 'View details' })).toHaveAttribute(
    'href',
    '/property/sale-ftl',
  );
  await expect(
    page.getByRole('button', { name: /618 NE 7th St, Boca Raton.*map pin 3 of 3/i }),
  ).toHaveCount(1);
});

test('pins use each stored coordinate rather than a city center', async ({ page }) => {
  const positioned = results.slice(0, 2).map((item, index) => ({
    ...item,
    property: {
      ...item.property,
      city: 'Fort Lauderdale',
      county: 'Broward',
      longitude: index === 0 ? -80.115 : -80.19,
      latitude: index === 0 ? 26.19 : 25.76,
    },
  }));
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: positioned } }));
  await page.goto('/');
  const pins = page.locator('.map-pin');
  await expect(pins).toHaveCount(2);
  const east = await pins.nth(0).evaluate((element) => Number(element.getAttribute('x')));
  const west = await pins.nth(1).evaluate((element) => Number(element.getAttribute('x')));
  const north = await pins.nth(0).evaluate((element) => Number(element.getAttribute('y')));
  const south = await pins.nth(1).evaluate((element) => Number(element.getAttribute('y')));
  expect(east).toBeGreaterThan(west);
  expect(north).toBeLessThan(south);
  await expect(page.locator('.map-pin-button').first()).not.toHaveAttribute(
    'aria-label',
    /approximate city location/,
  );
});

test('Google Maps loads county borders and frames the current results without provider requests', async ({
  page,
}) => {
  const positioned = results.slice(0, 2).map((item, index) => ({
    ...item,
    property: {
      ...item.property,
      longitude: index === 0 ? -80.115 : -80.19,
      latitude: index === 0 ? 26.19 : 25.76,
    },
  }));
  let listingReads = 0;
  let mapsLoads = 0;
  await page.route('**/api/google-maps-key', (route) =>
    route.fulfill({ json: { key: 'fake-maps-key' } }),
  );
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => {
    listingReads += 1;
    return route.fulfill({ json: { items: positioned } });
  });
  await page.route('https://maps.googleapis.com/maps/api/js?**', (route) => {
    mapsLoads += 1;
    return route.fulfill({
      contentType: 'text/javascript',
      body: `
        window.__mapsCalls = { borders: 0, bounds: [], markers: [] };
        window.google = { maps: {
          Map: class { fitBounds(bounds) { window.__mapsCalls.bounds.push(bounds.points); } },
          LatLngBounds: class { constructor() { this.points = []; } extend(point) { this.points.push(point); } },
          Marker: class {
            constructor() { window.__mapsCalls.markers.push(this); }
            setMap() {} setZIndex() {} setIcon(icon) { this.icon = icon; } setLabel() {}
            addListener(event, handler) { this[event] = handler; return { remove() {} }; }
          },
          Polygon: class { constructor() { window.__mapsCalls.borders++; } setMap() {} },
          SymbolPath: { CIRCLE: 0 }
        } };
        window.__ledgerlineMapsReady();
      `,
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Google map of current results')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __mapsCalls: { borders: number } }).__mapsCalls.borders,
      ),
    )
    .toBe(3);
  const markerScale = await page.evaluate(
    () =>
      (window as unknown as { __mapsCalls: { markers: { icon: { scale: number } }[] } }).__mapsCalls
        .markers[0].icon.scale,
  );
  expect(markerScale).toBeGreaterThanOrEqual(22);
  const bounds = await page.evaluate(() =>
    (
      window as unknown as { __mapsCalls: { bounds: { lat: number; lng: number }[][] } }
    ).__mapsCalls.bounds.at(-1),
  );
  expect(bounds).toHaveLength(2);
  expect(bounds![0].lng).toBeGreaterThan(-80.3);
  expect(bounds![1].lng).toBeLessThan(-80);
  expect(bounds![0].lat).toBeGreaterThan(25.6);
  expect(bounds![1].lat).toBeLessThan(26.3);
  const pin = page.getByRole('button', { name: /3250 NE 2nd Ave, Miami; map pin 2 of 2/ });
  await pin.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#listing-sale-miami')).toHaveClass(/is-selected/);
  await page.evaluate(() =>
    (
      window as unknown as { __mapsCalls: { markers: { click: () => void }[] } }
    ).__mapsCalls.markers[0].click(),
  );
  await expect(page.locator('#listing-sale-ftl')).toHaveClass(/is-selected/);
  const reads = listingReads;
  await pin.click();
  expect(listingReads).toBe(reads);
  expect(mapsLoads).toBe(1);
});

test('a failed Google script falls back to the local framed map', async ({ page }) => {
  await page.route('**/api/google-maps-key', (route) =>
    route.fulfill({ json: { key: 'fake-maps-key' } }),
  );
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: results } }));
  await page.route('https://maps.googleapis.com/maps/api/js?**', (route) => route.abort());
  await page.goto('/');
  await expect(
    page.getByText('Add a Google Maps key in Settings to show the street map.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.county-shape')).toHaveCount(3);
});

test('no Maps key draws local pins without contacting Google', async ({ page }) => {
  let googleRequests = 0;
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: results } }));
  await page.route('**/api/google-maps-key', (route) => route.fulfill({ json: { key: null } }));
  await page.route('https://maps.googleapis.com/**', (route) => {
    googleRequests += 1;
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.county-shape')).toHaveCount(3);
  await expect(
    page.getByText('Add a Google Maps key in Settings to show the street map.', { exact: false }),
  ).toBeVisible();
  expect(googleRequests).toBe(0);
});

test('an authentication failure after script load returns to the local map', async ({ page }) => {
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: results } }));
  await page.route('**/api/google-maps-key', (route) =>
    route.fulfill({ json: { key: 'fake-invalid-key' } }),
  );
  await page.route('https://maps.googleapis.com/maps/api/js?**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        window.google = { maps: {
          Map: class { fitBounds() {} },
          LatLngBounds: class { extend() {} },
          Marker: class { setMap() {} setZIndex() {} setIcon() {} setLabel() {} addListener() { return { remove() {} }; } },
          Polygon: class { setMap() {} },
          SymbolPath: { CIRCLE: 0 }
        } };
        window.__ledgerlineMapsReady();
        setTimeout(() => window.gm_authFailure(), 100);
      `,
    }),
  );
  await page.goto('/');
  await expect(page.locator('.county-shape')).toHaveCount(3);
});
