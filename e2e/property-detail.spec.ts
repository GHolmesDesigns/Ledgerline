import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDatabase, routeApiTo, seedDatabase, startApi, type Api } from './support/api';

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
        comparableRent: {
          figure: { value: 5200 },
          label: 'same home · listed Sep 28',
          stale: false,
          comps: [],
        },
        costEstimate: {
          lines: [
            {
              key: 'principalInterest',
              label: 'Principal and interest',
              monthly: 4293,
              state: 'Calc',
              note: '$679,200 loan · 6.50% · 30 yr',
            },
            {
              key: 'propertyTax',
              label: 'Property tax',
              monthly: 1380,
              state: 'Calc',
              note: 'Broward millage (sample) · set Oct 7 · from county tax collector',
            },
            {
              key: 'homeowners',
              label: 'Homeowners insurance',
              monthly: 610,
              state: 'Quote',
              note: 'entered Oct 5',
            },
            {
              key: 'flood',
              label: 'Flood insurance',
              monthly: 180,
              state: 'Est.',
              note: 'enter a quote',
            },
          ],
          totalStatus: 'Estimate',
          statusLabel: 'Estimate · needs flood quote',
          totalLabel: '$7,171/mo',
          monthlyTotal: 7171,
          knownSubtotal: 7171,
          upfrontCash: 169800,
          upfrontLabel: '$169,800',
        },
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
  await expect(page.getByRole('heading', { name: 'Monthly cost to own' })).toBeVisible();
  await expect(
    page.getByText('Broward millage (sample) · set Oct 7 · from county tax collector'),
  ).toBeVisible();
  await expect(page.getByText('Estimate · needs flood quote')).toBeVisible();
  await expect(page.getByText('≈ +$1,971/mo vs. comparable rent')).toBeVisible();
  await expect(page.getByText('Upfront cash: $169,800')).toBeVisible();
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

test('property risk details display, edit, and survive a JSON backup restore', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-risk-'));
  let sourceApi: Api | undefined;
  let targetApi: Api | undefined;
  try {
    const sourcePath = join(root, 'source.sqlite');
    const targetPath = join(root, 'target.sqlite');
    seedDatabase(sourcePath);
    sourceApi = await startApi(sourcePath);
    const listingResponse = await fetch(sourceApi.url('/api/listings?mode=sale'));
    const listings = (await listingResponse.json()) as {
      items: Array<{ property: { id: string; street: string; city: string } }>;
    };
    const hollywood = listings.items.find(({ property }) => property.street === '2801 N Ocean Dr')!;
    const fortLauderdale = listings.items.find(
      ({ property }) => property.street === '2207 NE 32nd Ct',
    )!;
    await routeApiTo(page, () => sourceApi!);

    await page.goto(`/property/${hollywood.property.id}`);
    await expect(page.getByText('filed', { exact: true })).toBeVisible();
    await expect(page.getByText('40-year in progress', { exact: true })).toBeVisible();
    await expect(page.getByText('pending, amount unknown', { exact: true })).toBeVisible();
    await page.getByLabel('Association details source').fill('Association disclosure');
    await page.getByRole('button', { name: 'Save association details' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Property details saved.' }),
    ).toBeVisible();

    await page.goto(`/property/${fortLauderdale.property.id}`);
    await expect(page.getByText('Roof 2020 · built 1964')).toBeVisible();
    await expect(page.getByText('Wind mitigation: impact windows')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Condo & association' })).toHaveCount(0);
    await page.getByLabel('Carrier review age limit (years)').fill('5');
    await expect(page.getByText('Roof 2020 · built 1964 · may limit carriers')).toBeVisible();

    const exported = await fetch(sourceApi.url('/api/backup/export'));
    const backup = await exported.json();
    targetApi = await startApi(targetPath);
    const targetImport = await fetch(targetApi.url('/api/backup/import'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(backup),
    });
    expect(targetImport.ok).toBeTruthy();
    const database = await readDatabase(targetPath);
    const restored = database.rows("SELECT id FROM properties WHERE street = '2801 N Ocean Dr'")[0];
    database.close();
    expect(restored).toBeTruthy();
    const details = await fetch(targetApi.url(`/api/properties/${restored!.id}`));
    const restoredProperty = (await details.json()) as {
      property: { riskDetails: { associationSource: string; specialAssessment: string } };
    };
    expect(restoredProperty.property.riskDetails.associationSource).toBe('Association disclosure');
    expect(restoredProperty.property.riskDetails.specialAssessment).toBe('pending, amount unknown');
  } finally {
    await sourceApi?.stop();
    await targetApi?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('comparable rent uses same-home priority, shows stored comps, and saves minimum-comp rules', async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-rent-comps-'));
  let api: Api | undefined;
  try {
    const databasePath = join(root, 'ledgerline.sqlite');
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    const budgetBefore = (await (await fetch(api.url('/api/request-budget'))).json()) as {
      used: number;
    };
    const listingResponse = await fetch(api.url('/api/listings?mode=sale'));
    const listings = (await listingResponse.json()) as {
      items: Array<{ property: { id: string; street: string; city: string } }>;
    };
    const fortLauderdale = listings.items.find(
      ({ property }) => property.street === '2207 NE 32nd Ct',
    )!;
    const northMiami = listings.items.find(
      ({ property }) => property.street === '1460 NE 135th St',
    )!;
    const bocaRaton = listings.items.find(({ property }) => property.street === '618 NE 7th St')!;
    await routeApiTo(page, () => api!);

    await page.goto('/');
    await expect(
      page.locator('.listing-card').filter({ hasText: '2207 NE 32nd Ct' }),
    ).toContainText('$5,200/mo · same home · listed Sep 28');
    await page.goto(`/property/${fortLauderdale.property.id}`);
    await expect(page.getByText('$5,200/mo · same home · listed Sep 28')).toBeVisible();
    await expect(page.getByText('Local comps (4)')).toBeVisible();
    await expect(page.getByText('Median: $5,225/mo · 4 comps')).toBeVisible();

    await page.goto(`/property/${northMiami.property.id}`);
    await expect(page.getByText('Unavailable · only 2 local comps')).toBeVisible();
    const budgetAfterOpeningDetail = (await (
      await fetch(api.url('/api/request-budget'))
    ).json()) as {
      used: number;
      remaining: number;
    };
    expect(budgetAfterOpeningDetail.used).toBe(budgetBefore.used);
    await page.getByRole('button', { name: 'Save property' }).click();
    const estimateButton = page.getByRole('button', {
      name: /Get RentCast rent estimate · 1 request · \d+ left this month/,
    });
    await expect(estimateButton).toBeVisible();
    await estimateButton.click();
    await expect(
      page.getByText(/\$2,300\/mo · RentCast estimate · range \$2,000–\$2,600 ·/),
    ).toBeVisible();
    const budgetAfterEstimate = (await (await fetch(api.url('/api/request-budget'))).json()) as {
      used: number;
      rentEstimatesUsed: number;
    };
    expect(budgetAfterEstimate.used).toBe(budgetBefore.used + 1);
    expect(budgetAfterEstimate.rentEstimatesUsed).toBe(1);
    await page.goto('/settings');
    await page.getByLabel('Minimum comps').fill('2');
    await page.getByRole('button', { name: 'Save comparable-rent rules' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.goto(`/property/${northMiami.property.id}`);
    await expect(
      page.getByText('$3,100/mo · 2 local comps · median · within 0.6 mi'),
    ).toBeVisible();
    await fetch(api.url('/api/request-budget'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ceiling: budgetAfterEstimate.used }),
    });
    await page.goto(`/property/${bocaRaton.property.id}`);
    await page.getByRole('button', { name: 'Save property' }).click();
    const blockedEstimate = page.getByRole('button', { name: /Get RentCast rent estimate/ });
    await expect(blockedEstimate).toBeDisabled();
    await expect(page.getByText(/Request ceiling reached/)).toBeVisible();
    const budgetAfter = (await (await fetch(api.url('/api/request-budget'))).json()) as {
      used: number;
    };
    expect(budgetAfter.used).toBe(budgetAfterEstimate.used);
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('C34 flags suspicious values and accepts a sourced correction', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-quality-'));
  let api: Api | undefined;
  try {
    const databasePath = join(root, 'ledgerline.sqlite');
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    const response = await fetch(api.url('/api/listings?mode=sale'));
    const results = (await response.json()) as {
      items: Array<{
        property: { id: string; street: string; unit: string | null };
        listing: { id: string };
      }>;
    };
    const sample = results.items.find(
      ({ property }) => property.street === '3250 NE 2nd Ave' && property.unit === '507',
    )!;
    // A confirmed value stays outside the range, so its resolved flag is kept and backed up.
    const outlier = results.items.find(
      ({ property }) => property.street === '7000 Imaginary Palm Court',
    )!;
    await fetch(api.url(`/api/properties/${outlier.property.id}`));
    const confirmed = await fetch(api.url(`/api/listings/${outlier.listing.id}/implausible`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'livingAreaSqft', action: 'confirm' }),
    });
    expect(confirmed.status).toBe(200);
    await routeApiTo(page, () => api!);
    await page.goto(`/property/${sample.property.id}`);
    await expect(
      page.getByText(/\$98\/sq ft; this area runs about \$250–\$750 \(sample\)/),
    ).toBeVisible();
    await page.getByLabel('Correct livingAreaSqft').fill('700');
    await page.getByLabel('Source for livingAreaSqft').fill('county property record');
    await page.getByRole('button', { name: 'Correct value' }).click();
    await expect(page.getByText('700 sq ft · corrected from county property record')).toBeVisible();
    await expect(page.getByText(/\$98\/sq ft/)).toHaveCount(0);
    const exported = (await (await fetch(api.url('/api/backup/export'))).json()) as {
      properties: Array<{
        address: { street: string; unit: string | null };
        valueOverrides: Record<string, { value: number; source: string }>;
        listingFlags: Array<{ flags: Array<{ field: string; resolved?: boolean }> }>;
      }>;
    };
    const saved = exported.properties.find(
      (item) => item.address.street === '3250 NE 2nd Ave' && item.address.unit === '507',
    )!;
    expect(saved.valueOverrides.livingAreaSqft).toEqual(
      expect.objectContaining({ value: 700, source: 'county property record' }),
    );
    // 700 sq ft is $407/sq ft, inside the sample range, so no flag remains open.
    expect(
      saved.listingFlags.flatMap((listing) => listing.flags).filter((flag) => !flag.resolved),
    ).toEqual([]);
    const outlierSaved = exported.properties.find(
      (item) => item.address.street === '7000 Imaginary Palm Court',
    )!;
    expect(outlierSaved.listingFlags[0].flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'livingAreaSqft', resolved: true }),
      ]),
    );
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
