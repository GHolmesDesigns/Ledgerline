import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

test('property detail shows facts, separate history sources, and manual verification links', async ({
  page,
}) => {
  const listingSiteRequests: string[] = [];
  page.on('request', (request) => {
    if (/rentcast|redfin|zillow|realtor|\.mls\./i.test(request.url())) {
      listingSiteRequests.push(request.url());
    }
  });
  await page.route('**/api/properties/prop_1', (route) =>
    route.fulfill({
      json: {
        property: {
          id: 'prop_1',
          street: '2207 NE 32nd Ct',
          unit: null,
          city: 'Fort Lauderdale',
          zip: '33308',
          county: 'Broward',
          propertyType: 'single_family',
          beds: 3,
          bathsTotal: 2,
          bathsFull: 2,
          bathsHalf: 0,
          livingAreaSqft: 1850,
          lotSizeSqft: 9148,
          yearBuilt: 1964,
          latitude: 26.15,
          longitude: -80.12,
          parcelId: null,
        },
        listings: [
          {
            id: 'sale-1',
            mode: 'sale',
            price: 849000,
            pricePeriod: 'total',
            status: 'active',
            provider: 'mock',
            providerLastSeenDate: '2026-10-06',
            providerListedDate: '2026-08-20',
            firstFetchedAt: '2026-08-20T12:00:00Z',
            lastFetchedAt: '2026-10-06T12:00:00Z',
            fieldQuality: {},
            providerHistory: [],
            localSnapshots: [
              { id: 1, fetchedAt: '2026-10-06T12:00:00Z', price: 849000, status: 'active' },
            ],
            mlsName: 'MIAMI',
            mlsNumber: 'A123',
            agentName: 'A. Agent',
            agentPhone: null,
            agentEmail: null,
            officeName: null,
            officePhone: null,
            officeEmail: null,
            sourceUrl: null,
          },
          {
            id: 'rent-1',
            mode: 'rent',
            price: 5200,
            pricePeriod: 'month',
            status: 'active',
            provider: 'mock',
            providerLastSeenDate: '2026-10-06',
            firstFetchedAt: '2026-09-28T12:00:00Z',
            lastFetchedAt: '2026-10-06T12:00:00Z',
            fieldQuality: {},
            providerHistory: [],
            localSnapshots: [
              { id: 2, fetchedAt: '2026-10-06T12:00:00Z', price: 5200, status: 'active' },
            ],
            mlsName: null,
            mlsNumber: null,
            agentName: null,
            agentPhone: null,
            agentEmail: null,
            officeName: null,
            officePhone: null,
            officeEmail: null,
            sourceUrl: null,
          },
        ],
        notes: [],
        saved: false,
        dismissed: false,
      },
    }),
  );

  await page.goto('/property/prop_1');
  await expect(page.getByRole('heading', { name: '2207 NE 32nd Ct' })).toBeVisible();
  await expect(page.getByText('$849,000', { exact: true })).toBeVisible();
  await expect(page.getByText('$5,200/mo', { exact: true })).toBeVisible();
  await expect(page.getByText('9,148 sq ft')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Provider history' }).first()).toBeVisible();
  await expect(page.getByText('Not supplied by this provider.').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Local snapshots' }).first()).toBeVisible();
  await expect(page.getByText('MIAMI A123')).toBeVisible();
  await expect(page.getByText('A. Agent')).toBeVisible();
  await expect(
    page.locator('.verification-list').getByRole('link', { name: 'Search this address' }).first(),
  ).toHaveAttribute('href', /google\.com\/maps\/search/);
  await expect(page.getByRole('link', { name: 'Open Street View' })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=26.15,-80.12',
  );
  expect(listingSiteRequests).toEqual([]);
});

test('unknown property IDs show a not-found state', async ({ page }) => {
  await page.route('**/api/properties/prop_missing', (route) =>
    route.fulfill({ status: 404, json: { error: 'Property not found.' } }),
  );
  await page.goto('/property/prop_missing');
  await expect(page.getByRole('alert')).toHaveText('Property not found.');
});

test('property checklist records a flood quote and includes it in backup', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-costs-'));
  let api: Api | undefined;
  try {
    const databasePath = join(root, 'ledgerline.sqlite');
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    const listingResponse = await fetch(api.url('/api/listings?mode=sale'));
    const listings = (await listingResponse.json()) as {
      items: Array<{ property: { id: string; street: string } }>;
    };
    const fortLauderdale = listings.items.find(
      ({ property }) => property.street === '2207 NE 32nd Ct',
    )!;
    await routeApiTo(page, () => api!);
    await page.goto(`/property/${fortLauderdale.property.id}`);
    await expect(
      page.getByRole('heading', { name: 'Cost records and verification' }),
    ).toBeVisible();
    await expect(
      page.getByText('Tax bill: Done · Doc · Sample data — not real listings'),
    ).toBeVisible();
    await expect(
      page.getByText('HOA confirmation: Done · N/A · Sample data — not real listings'),
    ).toBeVisible();
    await expect(
      page.getByText('Homeowners quote: Done · Quote · Sample data — not real listings'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter flood quote' })).toBeVisible();
    await page.getByRole('button', { name: 'Enter flood quote' }).click();
    await page.getByLabel('Amount', { exact: true }).fill('195');
    await page.getByLabel('Source or document').fill('Carrier quote');
    await page.getByLabel('Date', { exact: true }).fill('2026-10-09');
    await page.getByRole('button', { name: 'Save cost record' }).click();
    await expect(page.getByText(/flood quote · Quote \$195/)).toBeVisible();
    const backup = await fetch(api.url('/api/backup/export'));
    expect(backup.ok).toBeTruthy();
    const data = await backup.json();
    expect(
      data.properties.some((property: { costEntries: Array<{ kind: string }> }) =>
        property.costEntries.some((entry) => entry.kind === 'flood_quote'),
      ),
    ).toBeTruthy();
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
