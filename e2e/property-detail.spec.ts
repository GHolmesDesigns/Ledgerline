import { expect, test } from '@playwright/test';

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
