import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase } from '../database.js';
import { createStore } from '../store.js';
import { ProviderCredentials } from '../provider-credentials.js';
import { importProviderListings } from './import-listings.js';
import { MockListingProvider } from './mock-provider.js';
import { RentCastListingProvider, type RentCastFetch } from './rentcast-provider.js';
import { RequestBudget } from './request-budget.js';
import { RefreshJob } from './refresh-job.js';
import { createConfiguredListingProvider } from './configured-provider.js';

interface FixtureListing {
  id: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  zipCode: string;
  propertyType: string;
  [key: string]: unknown;
}

interface SyntheticFixtures {
  sale: FixtureListing[];
  rental: FixtureListing[];
}

const fixturePath = fileURLToPath(
  new URL('../../../../fixtures/rentcast-synthetic-listings.json', import.meta.url),
);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as SyntheticFixtures;
const directories: string[] = [];
const databases: Awaited<ReturnType<typeof openDatabase>>[] = [];
const fakeResponse = (value: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
});

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('RentCast listing provider', () => {
  it('maps sale and rental results and keeps provider history separate from snapshots', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher: RentCastFetch = async (url, init) => {
      calls.push({ url, headers: init.headers });
      const listing = url.includes('/rental/long-term')
        ? fixtures.rental[0]
        : fixtures.sale.find((item) => item.id === 'md-highrise-sale');
      return fakeResponse([listing]);
    };
    const provider = new RentCastListingProvider(() => 'secret-test-key', fetcher);

    const [sale] = await provider.search(
      {
        mode: 'sale',
        location: 'Fort Lauderdale 33308',
        priceMin: 300000,
        priceMax: 900000,
        beds: 2,
        baths: 1.5,
        minSqft: 900,
        propertyType: 'condo',
        statuses: ['active'],
      },
      1,
    );
    const [rental] = await provider.search({ mode: 'rent', location: 'Miami' }, 2);

    assert.ok(sale && rental);
    assert.equal(provider.name, 'RentCast');
    assert.equal(provider.pageSize, 500);
    assert.deepEqual(provider.capabilities, {
      photos: false,
      sourceUrl: false,
      waterfront: false,
      bathSplit: false,
      history: true,
      hoaFee: true,
      rentEstimates: true,
    });
    const saleUrl = new URL(calls[0]!.url);
    assert.equal(saleUrl.pathname, '/v1/listings/sale');
    assert.equal(saleUrl.searchParams.get('zipCode'), '33308');
    assert.equal(saleUrl.searchParams.get('price'), '300000:900000');
    assert.equal(saleUrl.searchParams.get('bedrooms'), '2');
    assert.equal(saleUrl.searchParams.get('bathrooms'), '1.5');
    assert.equal(saleUrl.searchParams.get('squareFootage'), '900:*');
    assert.equal(saleUrl.searchParams.get('propertyType'), 'Condo');
    assert.equal(saleUrl.searchParams.get('status'), 'Active');
    assert.equal(saleUrl.searchParams.get('limit'), '500');
    assert.equal(saleUrl.searchParams.get('offset'), '0');
    assert.deepEqual(calls[0]?.headers, {
      Accept: 'application/json',
      'X-Api-Key': 'secret-test-key',
    });
    assert.equal(new URL(calls[1]!.url).pathname, '/v1/listings/rental/long-term');
    assert.equal(new URL(calls[1]!.url).searchParams.get('city'), 'Miami');
    assert.equal(new URL(calls[1]!.url).searchParams.get('state'), 'FL');
    assert.equal(new URL(calls[1]!.url).searchParams.get('offset'), '500');

    assert.equal(sale.sourceId, 'sale:md-highrise-sale');
    assert.equal(sale.property.street, '2200 Imaginary Ocean Drive');
    assert.equal(sale.property.unit, '1804');
    assert.equal(sale.property.propertyType, 'condo');
    assert.equal(sale.property.bathsTotal, 2.5);
    assert.equal(sale.property.bathsFull, undefined);
    assert.equal(sale.property.county, 'Miami-Dade');
    assert.equal(sale.listing.price, 785000);
    assert.equal(sale.listing.pricePeriod, 'total');
    assert.equal(sale.listing.hoaFee, 1180);
    assert.equal(sale.listing.mlsNumber, 'SYN-MD-002');
    assert.equal(sale.listing.agentEmail, 'b@example.invalid');
    assert.equal(sale.listing.officePhone, '5550100002');
    assert.equal(sale.listing.providerListedDate, '2026-09-20T00:00:00.000Z');
    assert.equal(sale.listing.providerLastSeenDate, '2026-10-07T12:00:00.000Z');
    assert.deepEqual(sale.listing.providerHistory, [
      { date: '2026-09-10', price: 825000, status: null },
      { date: '2026-09-20', price: 785000, status: null },
      { date: '2026-10-01', price: 785000, status: 'pending' },
      { date: '2026-10-04', price: 785000, status: 'active' },
    ]);
    assert.equal(
      sale.rawPayload,
      fixtures.sale.find((item) => item.id === 'md-highrise-sale'),
    );
    assert.equal(rental.sourceId, `rent:${fixtures.rental[0]!.id}`);
    assert.equal(rental.listing.mode, 'rent');
    assert.equal(rental.listing.pricePeriod, 'month');
  });

  it('maps missing and unknown provider fields without leaking RentCast field names into the model', async () => {
    const fetcher: RentCastFetch = async (url) => {
      const listing = url.includes('/rental/long-term')
        ? fixtures.rental.find((item) => item.id === 'br-house-rent')
        : fixtures.sale.find((item) => item.id === 'md-unknown-type');
      return fakeResponse([listing]);
    };
    const provider = new RentCastListingProvider(() => 'test-key', fetcher);
    const [unknownType] = await provider.search({ mode: 'sale', location: 'Miami' }, 1);
    const [missing] = await provider.search({ mode: 'rent', location: 'Fort Lauderdale' }, 1);

    assert.ok(unknownType && missing);
    assert.equal(unknownType.property.propertyType, 'other');
    assert.match(unknownType.listing.fieldQuality?.propertyType ?? '', /unknown provider value/);
    assert.equal(missing.property.beds, 3);
    assert.equal(missing.property.livingAreaSqft, 1450);
    assert.equal(missing.property.latitude, null);
    assert.equal(missing.listing.hoaFee, null);
    assert.equal(missing.listing.mlsName, null);
    assert.equal(missing.listing.agentName, null);
    assert.equal(missing.listing.providerHistory?.length, 0);
    assert.equal('formattedAddress' in missing.property, false);
    assert.equal('bedrooms' in missing.property, false);
  });

  it('requests one normalized long-term rent estimate and keeps its returned rental comps', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const provider = new RentCastListingProvider(
      () => 'test-key',
      async (url, init) => {
        calls.push({ url, headers: init.headers });
        return fakeResponse({
          rent: 3250,
          rentRangeLow: 3000,
          rentRangeHigh: 3500,
          comparables: [
            {
              id: 'rent-comp-1',
              formattedAddress: '1 Sample Ave, Miami, FL 33131',
              price: 3200,
              distance: 0.4,
            },
          ],
        });
      },
    );
    const estimate = await provider.estimateRent!({
      property: {
        street: '200 Sample Ave',
        unit: '5',
        city: 'Miami',
        zip: '33131',
        propertyType: 'condo',
        beds: 2,
        bathsTotal: 2,
        livingAreaSqft: 1000,
        latitude: 25.76,
        longitude: -80.19,
      },
    });
    const request = new URL(calls[0]!.url);
    assert.equal(request.pathname, '/v1/avm/rent/long-term');
    assert.equal(request.searchParams.get('latitude'), '25.76');
    assert.equal(request.searchParams.get('propertyType'), 'Condo');
    assert.equal(request.searchParams.get('bedrooms'), '2');
    assert.deepEqual(estimate, {
      value: 3250,
      low: 3000,
      high: 3500,
      comps: [
        {
          id: 'rent-comp-1',
          address: '1 Sample Ave, Miami, FL 33131',
          rent: 3200,
          distanceMi: 0.4,
        },
      ],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.headers['X-Api-Key'], 'test-key');
  });

  it('loads one listing by its mode-qualified ID and returns null for a missing listing', async () => {
    const calls: string[] = [];
    const provider = new RentCastListingProvider(
      () => 'test-key',
      async (url) => {
        calls.push(url);
        return calls.length === 1
          ? fakeResponse(fixtures.rental[0])
          : fakeResponse({ error: 'not found' }, 404);
      },
    );
    const listing = await provider.getListing('rent:id/with spaces');
    const missing = await provider.getListing('sale:missing');

    assert.equal(new URL(calls[0]!).pathname, '/v1/listings/rental/long-term/id%2Fwith%20spaces');
    assert.equal(listing?.sourceId, `rent:${fixtures.rental[0]!.id}`);
    assert.equal(missing, null);
  });

  it('refuses calls without a key and hides upstream response bodies from errors', async () => {
    const noKey = new RentCastListingProvider(
      () => null,
      async () => fakeResponse([]),
    );
    await assert.rejects(
      noKey.search({ mode: 'sale', location: 'Miami' }, 1),
      /No RentCast key set/,
    );

    const badResponse = new RentCastListingProvider(
      () => 'secret-key',
      async () => fakeResponse({ message: 'secret-key should never be logged' }, 401),
    );
    await assert.rejects(
      badResponse.search({ mode: 'sale', location: 'Miami' }, 1),
      (error: Error) => error.message === 'RentCast request failed with HTTP 401.',
    );
  });
});

describe('configured provider switching', () => {
  it('switches mock to RentCast on config and preserves property personal data within budget', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-rentcast-switch-'));
    directories.push(directory);
    const credentials = new ProviderCredentials(join(directory, '.env'));
    assert.equal(credentials.getListingProvider(), 'mock');
    credentials.setListingProvider('rentcast');
    credentials.setRentCastKey('local-test-key');
    const calls: string[] = [];
    const provider = createConfiguredListingProvider(credentials, async (url, init) => {
      calls.push(url);
      assert.equal(init.headers['X-Api-Key'], 'local-test-key');
      const listing = fixtures.sale.find((item) => item.id === 'md-dual-sale');
      return url.includes('/md-dual-sale') ? fakeResponse(listing) : fakeResponse([listing]);
    });
    assert.equal(provider.name, 'RentCast');
    assert.equal(credentials.getListingProvider(), 'rentcast');
    assert.equal(credentials.isRentCastConfigured(), true);

    const database = await openDatabase(join(directory, 'ledgerline.sqlite'));
    databases.push(database);
    const store = createStore(database);
    const mock = new MockListingProvider();
    await importProviderListings(mock, store);
    const property = store.findPropertyByAddress({
      street: '101 Fictional Bay Way',
      city: 'Miami',
      zip: '00000',
    });
    assert.ok(property);
    store.addNote(property.id, 'Preserve across provider switch');
    store.setFavorite(property.id, true);
    store.setDismissed(property.id, true);
    const search = store.createSavedSearch({
      name: 'Synthetic Miami Buy',
      mode: 'sale',
      location: 'Miami',
      filters: { status: 'active' },
    });
    const budget = new RequestBudget(store);
    budget.configure({ ceiling: 2 });

    const job = new RefreshJob(store, provider, budget, () => credentials.getRentCastKey());
    const result = await job.refresh(search.id);

    assert.equal(result.error, undefined);
    assert.equal(result.imported?.snapshots, 1);
    assert.equal(calls.length, 1);
    assert.equal(store.listProviderRequestLogs().length, 1);
    assert.equal(store.listProviderRequestLogs()[0]?.provider, 'RentCast');
    assert.equal(store.listProviderRequestLogs()[0]?.status, 'succeeded');
    assert.equal(store.listListings(property.id).length, 3);
    assert.equal(store.listNotes(property.id)[0]?.body, 'Preserve across provider switch');
    assert.equal(store.isFavorite(property.id), true);
    assert.equal(store.isDismissed(property.id), true);

    const single = await job.getListing('sale:md-dual-sale');
    assert.equal(single?.sourceId, 'sale:md-dual-sale');
    assert.equal(calls.length, 2);
    assert.equal(store.listProviderRequestLogs()[1]?.purpose, 'listing-refresh');
    assert.equal(store.listProviderRequestLogs()[1]?.status, 'succeeded');

    await assert.rejects(job.getListing('sale:md-dual-sale'), /2 of 2 requests used/);
    assert.equal(calls.length, 2);
    assert.equal(store.listProviderRequestLogs().length, 2);

    const blocked = await job.refresh(search.id);
    assert.match(blocked.error ?? '', /2 of 2 requests used/);
    assert.equal(calls.length, 2);
    assert.equal(store.listProviderRequestLogs().length, 2);

    credentials.setListingProvider('mock');
    assert.equal(createConfiguredListingProvider(credentials).name, 'mock');
  });
});
