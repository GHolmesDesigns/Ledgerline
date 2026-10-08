import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase } from '../database.js';
import { createApp } from '../app.js';
import { createStore } from '../store.js';
import type { ListingProvider, ProviderListing, SearchCriteria } from './listing-provider.js';
import { MockListingProvider } from './mock-provider.js';
import { RefreshJob } from './refresh-job.js';

const directories: string[] = [];
const databases: Awaited<ReturnType<typeof openDatabase>>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-refresh-'));
  directories.push(directory);
  const database = await openDatabase(join(directory, 'ledgerline.sqlite'));
  databases.push(database);
  const store = createStore(database);
  const search = store.createSavedSearch({
    name: 'Miami 33131 · Buy',
    mode: 'sale',
    location: 'Miami 33131',
    refreshIntervalDays: 7,
    filters: { status: 'active' },
  });
  return { store, search };
}

function record(index: number, overrides: Partial<ProviderListing> = {}): ProviderListing {
  const property = {
    street: `${1000 + index} Sample St`,
    unit: null,
    city: 'Miami',
    zip: '33131',
    propertyType: 'single_family',
    beds: 3,
    bathsTotal: 2,
    livingAreaSqft: 1400,
  };
  const listing = {
    mode: 'sale' as const,
    price: 400000 + index,
    pricePeriod: 'total' as const,
    status: 'active',
  };
  return {
    sourceId: `sample-${index}`,
    property,
    listing,
    rawPayload: { sample: index },
    ...overrides,
  };
}

function provider(
  search: (criteria: SearchCriteria, page: number) => Promise<ProviderListing[]>,
  pageSize?: number,
): ListingProvider {
  return {
    name: 'test-provider',
    pageSize,
    capabilities: {
      photos: false,
      sourceUrl: false,
      waterfront: false,
      bathSplit: false,
      history: false,
      hoaFee: false,
      rentEstimates: false,
    },
    search,
    async getListing() {
      return null;
    },
  };
}

describe('saved-search refresh job', () => {
  it('pages through 501 listings, stores one snapshot per result, and logs two requests', async () => {
    const { store, search } = await setup();
    const records = Array.from({ length: 501 }, (_, index) => record(index));
    const mock = new MockListingProvider(records);
    const result = await new RefreshJob(store, mock).refresh(search.id);

    assert.equal(result.error, undefined, `refresh error: ${result.error}`);
    assert.equal(result.imported?.snapshots, 501);
    assert.equal(store.listProviderRequestLogs(search.id).length, 2);
    assert.deepEqual(
      store.listProviderRequestLogs(search.id).map((entry) => entry.resultCount),
      [500, 1],
    );
    const listings = store.searchListings({ mode: 'sale', location: 'Miami', showDismissed: true });
    assert.equal(listings.length, 501);
    assert.equal(
      listings.reduce(
        (total, listing) => total + store.listSnapshots(listing.listing.id).length,
        0,
      ),
      501,
    );
    assert.ok(store.getSavedSearch(search.id)?.lastSuccessfulRefreshAt);
  });

  it('preserves listings, snapshots, notes, and last success after a provider failure', async () => {
    const { store, search } = await setup();
    const first = record(1);
    const working = provider(async (_criteria, page) => (page === 1 ? [first] : []), 500);
    await new RefreshJob(store, working).refresh(search.id);
    const property = store.listProperties()[0]!;
    store.addNote(property.id, 'Keep this note');
    const successfulAt = store.getSavedSearch(search.id)?.lastSuccessfulRefreshAt;
    const listingBefore = store.listListings(property.id)[0]!;
    const failing = provider(async (_criteria, page) => {
      if (page === 1) return [{ ...first, listing: { ...first.listing, price: 1 } }];
      throw new Error('mock network disconnected');
    }, 1);

    const result = await new RefreshJob(store, failing).refresh(search.id);

    assert.match(result.error ?? '', /mock network disconnected/);
    assert.equal(store.getSavedSearch(search.id)?.lastSuccessfulRefreshAt, successfulAt);
    assert.match(
      store.getSavedSearch(search.id)?.lastRefreshError ?? '',
      /mock network disconnected/,
    );
    assert.equal(store.getSavedSearch(search.id)?.lastRefreshAttemptAt != null, true);
    assert.deepEqual(store.listListings(property.id), [listingBefore]);
    assert.equal(store.listSnapshots(listingBefore.id).length, 1);
    assert.equal(store.listNotes(property.id)[0]?.body, 'Keep this note');
    assert.equal(store.listProviderRequestLogs(search.id).at(-1)?.status, 'failed');
  });

  it('retains a previously stored listing and provider last-seen date when absent from a refresh', async () => {
    const { store, search } = await setup();
    const seen = '2026-10-01';
    const existing = record(21, {
      listing: { ...record(21).listing, providerLastSeenDate: seen },
    });
    await new RefreshJob(
      store,
      provider(async (_criteria, page) => (page === 1 ? [existing] : []), 500),
    ).refresh(search.id);
    const stored = store.listProperties()[0]!;
    const listingBefore = store.listListings(stored.id)[0]!;

    await new RefreshJob(
      store,
      provider(async () => [], 500),
    ).refresh(search.id);

    const listingAfter = store.listListings(stored.id)[0]!;
    assert.equal(listingAfter.status, listingBefore.status);
    assert.equal(listingAfter.providerLastSeenDate, seen);
    assert.equal(store.listSnapshots(listingAfter.id).length, 1);
  });

  it('keeps nullable intervals unscheduled and uses the configured interval for due checks', async () => {
    const { store, search } = await setup();
    const neverScheduled = store.createSavedSearch({
      name: 'Manual only',
      mode: 'rent',
      location: 'Miami',
    });
    store.markRefreshSucceeded(search.id, '2026-10-01T12:00:00.000Z');
    assert.deepEqual(
      store.listDueSavedSearches('2026-10-08T12:00:00.000Z').map((item) => item.id),
      [search.id],
    );
    assert.equal(store.listDueSavedSearches('2026-10-07T12:00:00.000Z').length, 0);
    assert.equal(
      store.listDueSavedSearches().some((item) => item.id === neverScheduled.id),
      false,
    );
  });

  it('does not call the provider from local result reads', async () => {
    const { store } = await setup();
    let requests = 0;
    const localOnly = provider(async () => {
      requests += 1;
      return [];
    });
    const job = new RefreshJob(store, localOnly);
    const database = databases.at(-1)!;
    const server = createApp(database, store, job);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/listings?mode=sale`);
      assert.equal(response.status, 200);
      assert.equal(requests, 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('exposes manual refresh for one saved search and for all due searches', async () => {
    const { store, search } = await setup();
    const manualOnly = store.createSavedSearch({
      name: 'Another',
      mode: 'rent',
      location: 'Miami',
    });
    const dueSearch = store.createSavedSearch({
      name: 'Due search',
      mode: 'sale',
      location: 'Miami',
      refreshIntervalDays: 7,
    });
    let calls = 0;
    const localProvider = provider(async (_criteria, page) => {
      calls += 1;
      return page === 1 ? [record(8)] : [];
    }, 500);
    const job = new RefreshJob(store, localProvider);
    const database = databases.at(-1)!;
    const server = createApp(database, store, job);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/saved-searches/${search.id}/refresh`,
        { method: 'POST' },
      );
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(store.getSavedSearch(search.id)?.lastSuccessfulRefreshAt != null, true);
      assert.equal(calls, 1);
      const due = await fetch(`http://127.0.0.1:${address.port}/api/saved-searches/refresh-due`, {
        method: 'POST',
      });
      assert.equal(due.status, 200);
      assert.equal(store.getSavedSearch(manualOnly.id)?.lastSuccessfulRefreshAt, null);
      assert.equal(store.getSavedSearch(dueSearch.id)?.lastSuccessfulRefreshAt != null, true);
      assert.equal(calls, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
