import { expect, test, type Page } from '@playwright/test';

const listings = Array.from({ length: 5 }, (_, index) => {
  const number = index + 1;
  return {
    property: {
      id: `prop_${number}`,
      street: `Home ${number} St`,
      unit: null,
      city: 'Fort Lauderdale',
      zip: `3330${number}`,
      county: 'Broward',
      propertyType: 'single_family',
      beds: number,
      bathsTotal: 2,
      livingAreaSqft: 1500 + number * 100,
      yearBuilt: 1980 + number,
      latitude: null,
      longitude: null,
    },
    listing: {
      id: `listing_${number}`,
      mode: 'sale' as const,
      price: 300000 + number * 10000,
      pricePeriod: 'total',
      status: 'active',
      provider: 'mock',
      providerLastSeenDate: '2026-10-06',
    },
    saved: false,
    dismissed: false,
  };
});

async function mockData(page: Page) {
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: listings } }));
  await page.route('**/api/properties/prop_*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const entry = listings.find((item) => item.property.id === id);
    if (!entry) return route.fulfill({ status: 404, json: { error: 'Property not found.' } });
    const number = Number(id.slice('prop_'.length));
    return route.fulfill({
      json: {
        property: {
          ...entry.property,
          lotSizeSqft: 9000 + number,
          bathsFull: 2,
          bathsHalf: 0,
          parcelId: null,
        },
        listings: [
          {
            ...entry.listing,
            mlsName: 'MIAMI',
            mlsNumber: `A${number}`,
            sourceUrl: null,
            agentName: 'A. Agent',
            officeName: 'Local Realty',
            providerHistory: [],
            localSnapshots: [],
            fieldQuality: {},
            lastFetchedAt: '2026-10-06T12:00:00.000Z',
          },
        ],
        notes: [
          {
            id: number,
            propertyId: id,
            body: `Note for home ${number}`,
            createdAt: '2026-10-06T12:00:00.000Z',
            updatedAt: '2026-10-06T12:00:00.000Z',
          },
        ],
        saved: false,
        dismissed: false,
      },
    });
  });
}

test('adds four properties, refuses a fifth, and preserves compare order in a shareable URL', async ({
  page,
}) => {
  await mockData(page);
  await page.goto('/');
  for (let number = 1; number <= 4; number += 1) {
    await page.getByRole('button', { name: `Compare Home ${number} St` }).click();
  }
  await expect(page.getByText('4 of 4 properties selected')).toBeVisible();
  await page.getByRole('button', { name: 'Compare Home 5 St' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Compare is full' })).toBeVisible();
  await expect(page.getByText('4 of 4 properties selected')).toBeVisible();

  await page.getByRole('link', { name: 'View Compare' }).click();
  await expect(page).toHaveURL(/\/compare\?properties=prop_1%2Cprop_2%2Cprop_3%2Cprop_4$/);
  await expect(page.getByRole('columnheader', { name: /Home 1 St/ })).toBeVisible();
  await expect(page.locator('.compare-table thead th[data-property-id]')).toHaveCount(4);
  await expect(page.getByText('Note for home 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search address' }).first()).toHaveAttribute(
    'href',
    /google\.com\/maps\/search/,
  );

  await page.reload();
  await expect(page.locator('.compare-table thead th[data-property-id]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Remove Home 2 St from Compare' }).click();
  await expect(page).toHaveURL(/properties=prop_1%2Cprop_3%2Cprop_4$/);
  await expect(page.locator('.compare-table thead th[data-property-id]')).toHaveCount(3);
  await expect(page.getByRole('columnheader', { name: /Home 3 St/ })).toBeVisible();
});

test('mobile Compare shows two selectable properties from the URL set', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockData(page);
  await page.goto('/compare?properties=prop_1%2Cprop_2%2Cprop_3');
  await expect(page.getByLabel('Left property')).toBeVisible();
  await expect(page.getByLabel('Right property')).toBeVisible();
  await expect(page.locator('.compare-table thead th[data-property-id]')).toHaveCount(2);
  await expect(page.locator('.compare-table thead th[data-property-id="prop_1"]')).toBeVisible();
  await expect(page.locator('.compare-table thead th[data-property-id="prop_2"]')).toBeVisible();

  await page.getByLabel('Left property').selectOption('prop_3');
  await expect(page.locator('.compare-table thead th[data-property-id="prop_3"]')).toBeVisible();
  await expect(page.locator('.compare-table thead th[data-property-id="prop_1"]')).toHaveCount(0);
  await page.getByLabel('Right property').selectOption('prop_1');
  await expect(page.locator('.compare-table thead th[data-property-id="prop_1"]')).toBeVisible();
  await expect(page.locator('.compare-table thead th[data-property-id="prop_3"]')).toBeVisible();
});

test('property detail can add and remove its property from Compare', async ({ page }) => {
  await mockData(page);
  await page.goto('/property/prop_1');
  await page.getByRole('button', { name: 'Compare', exact: true }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Added to Compare' })).toBeVisible();
  await page.getByRole('link', { name: 'Compare', exact: true }).first().click();
  await expect(page).toHaveURL(/\/compare\?properties=prop_1$/);
  await expect(page.locator('.compare-table thead th[data-property-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove Home 1 St from Compare' }).click();
  await expect(page.getByRole('heading', { name: 'No properties to compare yet' })).toBeVisible();
});

test('Compare shows tagged cost rows and marks only the lowest complete total', async ({
  page,
}) => {
  const names = ['Fort Lauderdale', 'Miramar', 'North Miami', 'Hollywood'];
  const totals = [7171, 4525, null, null];
  const upfront = ['$169,800', '$93,000', '$112,000', '$77,800 + assessment (amount unknown)'];
  await page.route('**/api/properties/prop_*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const index = Number(id.slice('prop_'.length)) - 1;
    const totalStatus = index >= 2 ? 'Incomplete' : 'Estimate';
    const lineKeys = [
      'principalInterest',
      'propertyTax',
      'homeowners',
      'flood',
      'hoa',
      'nonAdValorem',
      'specialAssessment',
      'maintenance',
    ];
    return route.fulfill({
      json: {
        property: {
          id,
          street: names[index],
          unit: null,
          city: names[index],
          zip: `3330${index + 1}`,
          county: 'Broward',
          propertyType: 'single_family',
          beds: 3,
          bathsTotal: 2,
          livingAreaSqft: 1800,
          yearBuilt: 1980,
          floodZone: 'X',
          riskDetails: {
            roofYear: 2020,
            windMitigation: ['impact windows'],
            insuranceSource: 'Quote',
            milestoneInspection: null,
            countyRecertification: null,
            reserveStudy: null,
            specialAssessment: index === 3 ? 'pending' : null,
          },
        },
        listings: [{ id: `listing_${index + 1}`, mode: 'sale', price: 500000, status: 'active' }],
        notes: [],
        saved: false,
        dismissed: false,
        comparableRent: {
          figure: { value: 5200, source: 'local_comps' },
          label: '4 local comps · median · within 1 mi',
          stale: false,
        },
        costEstimate: {
          lines: lineKeys.map((key) => ({
            key,
            label: key,
            monthly: 100,
            state: key === 'flood' ? 'Est.' : 'Calculated',
            note: null,
          })),
          totalStatus,
          statusLabel:
            totalStatus === 'Incomplete'
              ? 'Incomplete · amount unknown'
              : 'Estimate · needs flood quote',
          totalLabel:
            totalStatus === 'Incomplete'
              ? `at least $${(index === 2 ? 4896 : 4661).toLocaleString()}`
              : `$${totals[index]}/mo`,
          monthlyTotal: totals[index],
          knownSubtotal: index === 2 ? 4896 : index === 3 ? 4661 : totals[index],
          upfrontCash: 0,
          upfrontLabel: upfront[index],
        },
      },
    });
  });
  await page.goto('/compare?properties=prop_1%2Cprop_2%2Cprop_3%2Cprop_4');
  const table = page.locator('.compare-table');
  await expect(table.getByText('P&I', { exact: true })).toBeVisible();
  await expect(
    table.locator('tbody tr:has(th:text-is("P&I")) td[data-property-id="prop_1"]'),
  ).toContainText('$100');
  await expect(
    table.locator('tbody tr:has(th:text-is("P&I")) td[data-property-id="prop_1"]'),
  ).toContainText('Calc');
  await expect(table.getByText('Non-ad valorem / CDD', { exact: true })).toBeVisible();
  await expect(table.getByText('Comparable rent', { exact: true })).toBeVisible();
  await expect(table.getByText('Upfront cash', { exact: true })).toBeVisible();
  await expect(table.getByText('$7,171')).toBeVisible();
  await expect(table.getByText('4 local comps · median · within 1 mi').first()).toBeVisible();
  await expect(table.getByText('Lowest complete total')).toHaveCount(1);
  await expect(
    table.locator('tbody tr:has(th:text-is("Total")) td[data-property-id="prop_2"]'),
  ).toContainText('Lowest complete total');
  for (const amount of upfront)
    await expect(table.getByText(amount, { exact: true })).toBeVisible();
  await expect(table.getByText('Calc', { exact: true }).first()).toBeVisible();
  await expect(table.getByText('Est.', { exact: true }).first()).toBeVisible();
});

test('empty Compare links to Search', async ({ page }) => {
  await page.goto('/compare');
  await expect(page.getByRole('heading', { name: 'No properties to compare yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to Search' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
});
