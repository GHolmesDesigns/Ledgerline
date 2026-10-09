import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

let root: string;
let api: Api;
let samplePropertyId: string;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-sample-data-'));
  const databasePath = join(root, 'data', 'ledgerline.sqlite');
  seedDatabase(databasePath);
  api = await startApi(databasePath);
  const results = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
    items: Array<{ property: { id: string; street: string } }>;
  };
  samplePropertyId = results.items.find((item) => item.property.street === '2207 NE 32nd Ct')!
    .property.id;
});

test.afterAll(async () => {
  await api?.stop();
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await routeApiTo(page, () => api);
});

async function setActiveProvider(page: Page, provider: string | null) {
  await page.route('**/api/request-budget', (route) =>
    provider == null ? route.abort() : route.fulfill({ json: { provider } }),
  );
}

test('keeps the global banner when the mock provider is active', async ({ page }) => {
  await setActiveProvider(page, 'mock');
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Sample data' })).toHaveText(
    'Sample data — not real listings',
  );
});

test('hides the banner and listing tags when only live listings are shown', async ({ page }) => {
  await setActiveProvider(page, 'rentcast');
  await page.route('**/api/listings?**', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: Array<{ listing: { provider: string } }>;
    };
    for (const item of body.items) item.listing.provider = 'rentcast';
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Sample data' })).toHaveCount(0);
  await expect(page.locator('.listing-card .sample-listing-tag')).toHaveCount(0);
});

test('labels stored mock listings on Search, Property, and Compare under a live provider', async ({
  page,
}) => {
  await setActiveProvider(page, 'rentcast');

  await page.goto('/');
  const card = page.locator('.listing-card').filter({ hasText: '2207 NE 32nd Ct' }).first();
  await expect(card.locator('.sample-listing-tag')).toHaveText('Sample data');

  await page.goto(`/property/${samplePropertyId}`);
  const propertyListings = page.locator('section[aria-labelledby="property-listings-heading"]');
  await expect(propertyListings.locator('.sample-listing-tag').first()).toHaveText('Sample data');

  await page.goto(`/compare?properties=${samplePropertyId}`);
  const providerRow = page
    .locator('.compare-table tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Provider' }) });
  await expect(providerRow.locator('.sample-listing-tag').first()).toHaveText('Sample data');
});

test('keeps the global banner visible when usage cannot identify the provider', async ({
  page,
}) => {
  await setActiveProvider(page, null);
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Sample data' })).toHaveText(
    'Sample data — not real listings',
  );
});
