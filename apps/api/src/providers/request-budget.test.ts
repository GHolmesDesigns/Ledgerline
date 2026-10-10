import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase } from '../database.js';
import { createApp } from '../app.js';
import { createStore } from '../store.js';
import type { ListingProvider, ProviderListing } from './listing-provider.js';
import { RefreshJob } from './refresh-job.js';
import { billingPeriod, RequestBudget } from './request-budget.js';

const directories: string[] = [];
const databases: Awaited<ReturnType<typeof openDatabase>>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function setup(startsAt = '2026-10-08T12:00:00.000Z') {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-budget-'));
  directories.push(directory);
  const database = await openDatabase(join(directory, 'ledgerline.sqlite'));
  databases.push(database);
  let current = new Date(startsAt);
  const clock = () => current;
  const store = createStore(database, { clock });
  const budget = new RequestBudget(store, clock);
  const search = store.createSavedSearch({ name: 'Miami · Buy', mode: 'sale', location: 'Miami' });
  /** Logs n requests, as if a past refresh of the search had sent them. */
  const logRequests = (n: number, savedSearchId = search.id) => {
    for (let page = 1; page <= n; page += 1) {
      const id = store.beginProviderRequest({
        provider: 'test-provider',
        savedSearchId,
        purpose: 'saved-search-refresh',
        page,
      });
      store.finishProviderRequest(id, { status: 'succeeded', resultCount: 1 });
    }
  };
  const otherSearch = (name = 'Other') =>
    store.createSavedSearch({ name, mode: 'rent', location: 'Miami' });
  return {
    database,
    store,
    budget,
    search,
    logRequests,
    otherSearch,
    setNow: (value: string) => {
      current = new Date(value);
    },
  };
}

function record(index: number): ProviderListing {
  return {
    sourceId: `sample-${index}`,
    property: {
      street: `${1000 + index} Sample St`,
      unit: null,
      city: 'Miami',
      zip: '33131',
      propertyType: 'single_family',
      beds: 3,
      bathsTotal: 2,
      livingAreaSqft: 1400,
    },
    listing: { mode: 'sale', price: 400000, pricePeriod: 'total', status: 'active' },
    rawPayload: {},
  };
}

/** Returns one listing per page for `pages` pages, then an empty page. Counts every call. */
function countingProvider(options: { pages?: number; estimate?: boolean } = {}) {
  const calls = { search: 0, estimate: 0 };
  const provider: ListingProvider = {
    name: 'test-provider',
    pageSize: 1,
    capabilities: {
      photos: false,
      sourceUrl: false,
      waterfront: false,
      bathSplit: false,
      history: false,
      hoaFee: false,
      rentEstimates: options.estimate ?? false,
    },
    async search(_criteria, page) {
      calls.search += 1;
      return page <= (options.pages ?? 1) ? [record(page)] : [];
    },
    async getListing() {
      return null;
    },
    ...(options.estimate
      ? {
          async estimateRent() {
            calls.estimate += 1;
            return {
              value: 2300,
              low: 2000,
              high: 2600,
              comps: [
                {
                  id: 'mock-rent-comp-1',
                  address: '900 Fictional Ave, Miami, FL 33131',
                  rent: 2250,
                  distanceMi: 0.4,
                },
              ],
            };
          },
        }
      : {}),
  };
  return { provider, calls };
}

async function serve(...args: Parameters<typeof createApp>) {
  const server = createApp(...args);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe('billing period', () => {
  const day = (value: Date) => value.toISOString().slice(0, 10);

  it('starts on the billing day and resets on the next one', () => {
    const before = billingPeriod(new Date('2026-10-14T23:59:59.000Z'), 15);
    assert.deepEqual([day(before.start), day(before.next)], ['2026-09-15', '2026-10-15']);
    const on = billingPeriod(new Date('2026-10-15T00:00:00.000Z'), 15);
    assert.deepEqual([day(on.start), day(on.next)], ['2026-10-15', '2026-11-15']);
  });

  it('rolls over the year', () => {
    const early = billingPeriod(new Date('2027-01-03T00:00:00.000Z'), 10);
    assert.deepEqual([day(early.start), day(early.next)], ['2026-12-10', '2027-01-10']);
    const late = billingPeriod(new Date('2026-12-20T00:00:00.000Z'), 10);
    assert.deepEqual([day(late.start), day(late.next)], ['2026-12-10', '2027-01-10']);
  });

  it('uses the last day of a month shorter than the billing day', () => {
    const period = billingPeriod(new Date('2027-03-02T00:00:00.000Z'), 31);
    assert.deepEqual([day(period.start), day(period.next)], ['2027-02-28', '2027-03-31']);
  });
});

describe('request ceiling check', () => {
  it('defaults to 45 requests and resets on the 1st', async () => {
    const { budget } = await setup();
    assert.equal(budget.status().ceiling, 45);
    assert.equal(budget.status().billingDay, 1);
    assert.equal(budget.status().nextReset, '2026-11-01T00:00:00.000Z');
  });

  it('allows a request that reaches the ceiling exactly and blocks one past it', async () => {
    const { budget, logRequests } = await setup();
    logRequests(44);
    assert.equal(budget.check(1, 'Refresh').allowed, true);
    const blocked = budget.check(2, 'Refresh');
    assert.equal(blocked.allowed, false);
    assert.match(blocked.message!, /44 of 45 requests used/);
    assert.match(blocked.message!, /projected at 2/);
    assert.match(blocked.message!, /Nothing was sent/);
    logRequests(1, undefined);
    assert.equal(budget.check(1, 'Rent estimate').allowed, false);
  });

  it('blocks everything when the ceiling is below current usage, until the month resets', async () => {
    const { budget, logRequests, setNow } = await setup();
    logRequests(10);
    budget.configure({ ceiling: 5 });
    assert.equal(budget.check(1, 'Refresh').allowed, false);
    setNow('2026-11-01T00:00:00.000Z');
    assert.equal(budget.status().used, 0);
    assert.equal(budget.check(1, 'Refresh').allowed, true);
  });

  it('counts only requests since the billing day', async () => {
    const { budget, logRequests, setNow } = await setup('2026-09-20T12:00:00.000Z');
    logRequests(4);
    setNow('2026-10-08T12:00:00.000Z');
    logRequests(2);
    assert.equal(budget.status().used, 2);
    budget.configure({ billingDay: 15 });
    assert.equal(budget.status().used, 6);
    setNow('2026-10-15T00:00:00.000Z');
    assert.equal(budget.status().used, 0);
  });

  it('validates the settings and saves nothing when one is invalid', async () => {
    const { budget } = await setup();
    assert.throws(() => budget.configure({ ceiling: -1 }), /Request ceiling/);
    assert.throws(() => budget.configure({ ceiling: 4.5 }), /Request ceiling/);
    assert.throws(() => budget.configure({ ceiling: '45' }), /Request ceiling/);
    assert.throws(() => budget.configure({ ceiling: 20, billingDay: 32 }), /Billing day/);
    assert.throws(() => budget.configure({ billingDay: 0 }), /Billing day/);
    assert.equal(budget.status().ceiling, 45);
    assert.equal(budget.configure({ ceiling: 0 }).ceiling, 0);
  });

  it('projects a refresh at its last run, or 1 if it has never run', async () => {
    const { budget, search, otherSearch, logRequests } = await setup();
    assert.equal(budget.projectedRefresh(search.id), 1);
    logRequests(3);
    assert.equal(budget.projectedRefresh(search.id), 3);
    logRequests(2);
    assert.equal(budget.projectedRefresh(search.id), 2);
    assert.equal(budget.projectedRefresh(otherSearch().id), 1);
  });

  it('matches billable app and outside requests, explains errors and dashboard differences', async () => {
    const { budget, store, logRequests, setNow } = await setup();
    budget.configure({ billingDay: 7, includedRequests: 50 });
    logRequests(3);
    const failed = store.beginProviderRequest({
      provider: 'test-provider',
      purpose: 'other',
      page: 1,
    });
    store.finishProviderRequest(failed, { status: 'failed', errorMessage: 'test error' });
    budget.addOutsideRequest({ requestDate: '2026-10-07', count: 15, note: 'Milestone 0' });
    budget.addOutsideRequest({ requestDate: '2026-10-06', count: 2 });
    budget.configure({ dashboardUsed: 19, dashboardReadDate: '2026-10-08' });
    assert.deepEqual(
      [
        budget.status().appCount,
        budget.status().errorCount,
        budget.status().outsideCount,
        budget.status().used,
        budget.status().unexplained,
        budget.status().includedRequests,
      ],
      [4, 1, 15, 18, 1, 50],
    );
    assert.equal(budget.status().nextReset, '2026-11-07T00:00:00.000Z');
    assert.equal(budget.status().daysRemaining, 30);
    setNow('2026-11-07T00:00:00.000Z');
    assert.equal(budget.status().used, 0);
    assert.equal(budget.status().unexplained, null);
  });

  it('keeps the dashboard comparison tied to the date it was read', async () => {
    const { budget, logRequests, setNow } = await setup();
    logRequests(2);
    budget.configure({ dashboardUsed: 2, dashboardReadDate: '2026-10-08' });
    setNow('2026-10-09T12:00:00.000Z');
    logRequests(1);
    assert.equal(budget.status().used, 3);
    assert.equal(budget.status().unexplained, 0);
  });
});

describe('refresh and rent estimate enforcement', () => {
  it('blocks a mock refresh when outside requests take the matched total past the ceiling', async () => {
    const { database, store, budget, search, logRequests } = await setup();
    logRequests(1);
    budget.configure({ ceiling: 15 });
    const { provider, calls } = countingProvider();
    const api = await serve(database, store, new RefreshJob(store, provider, budget));
    try {
      const add = await fetch(`${api.url}/api/outside-requests`, {
        method: 'POST',
        body: JSON.stringify({ requestDate: '2026-10-08', count: 14, note: 'Milestone 0' }),
      });
      assert.equal(add.status, 201);
      const usage = (await (await fetch(`${api.url}/api/request-budget`)).json()) as {
        used: number;
        outsideCount: number;
        outsideRequests: Array<{ id: number }>;
      };
      assert.deepEqual([usage.used, usage.outsideCount], [15, 14]);
      const refresh = await fetch(`${api.url}/api/saved-searches/${search.id}/refresh`, {
        method: 'POST',
      });
      assert.equal(refresh.status, 429);
      assert.match(await refresh.text(), /15 of 15 requests used/);
      assert.equal(calls.search, 0);
      assert.equal(store.listProviderRequestLogs().length, 1);
      const removed = await fetch(
        `${api.url}/api/outside-requests/${usage.outsideRequests[0]!.id}`,
        { method: 'DELETE' },
      );
      assert.equal(removed.status, 200);
      assert.equal(budget.status().used, 1);
    } finally {
      await api.close();
    }
  });
  it('blocks a refresh projected at 2 with 44 of 45 used, and the provider receives nothing', async () => {
    const { store, budget, search, otherSearch, logRequests } = await setup();
    logRequests(2);
    logRequests(42, otherSearch().id);
    const { provider, calls } = countingProvider({ pages: 2 });
    const result = await new RefreshJob(store, provider, budget).refresh(search.id);

    assert.equal(calls.search, 0);
    assert.equal(result.blocked?.used, 44);
    assert.equal(result.blocked?.ceiling, 45);
    assert.equal(result.blocked?.projected, 2);
    assert.match(result.error!, /44 of 45 requests used/);
    assert.equal(store.listProviderRequestLogs().length, 44);
    assert.equal(store.getSavedSearch(search.id)?.lastRefreshError, result.error);
    assert.equal(store.getSavedSearch(search.id)?.lastSuccessfulRefreshAt, null);
  });

  it('blocks a direct call to the refresh endpoints the same way', async () => {
    const { database, store, budget, search, otherSearch, logRequests } = await setup();
    store.updateSavedSearch(search.id, { refreshIntervalDays: 7 });
    logRequests(2, otherSearch().id);
    budget.configure({ ceiling: 2 });
    const { provider, calls } = countingProvider({ pages: 2 });
    const api = await serve(database, store, new RefreshJob(store, provider, budget));
    try {
      const one = await fetch(`${api.url}/api/saved-searches/${search.id}/refresh`, {
        method: 'POST',
      });
      assert.equal(one.status, 429);
      const body = (await one.json()) as { result: { error: string; blocked: { used: number } } };
      assert.match(body.result.error, /2 of 2 requests used/);
      assert.equal(body.result.blocked.used, 2);

      const due = await fetch(`${api.url}/api/saved-searches/refresh-due`, { method: 'POST' });
      const dueBody = (await due.json()) as { results: Array<{ blocked?: unknown }> };
      assert.equal(dueBody.results.length, 1);
      assert.ok(dueBody.results[0]!.blocked);
      assert.equal(calls.search, 0);
      assert.equal(store.listProviderRequestLogs().length, 2);
    } finally {
      await api.close();
    }
  });

  it('stops mid-refresh when a later page would pass the ceiling, and imports nothing', async () => {
    const { store, budget, search, otherSearch, logRequests } = await setup();
    logRequests(2, otherSearch().id);
    budget.configure({ ceiling: 3 });
    const { provider, calls } = countingProvider({ pages: 5 });
    const result = await new RefreshJob(store, provider, budget).refresh(search.id);

    assert.equal(calls.search, 1);
    assert.ok(result.blocked);
    assert.equal(store.listProviderRequestLogs(search.id).length, 1);
    assert.equal(store.listProperties().length, 0);
    assert.equal(budget.status().used, 3);
  });

  it('lets a refresh through, logs it, and counts it, while the ceiling allows', async () => {
    const { store, budget, search } = await setup();
    const { provider, calls } = countingProvider({ pages: 1 });
    const result = await new RefreshJob(store, provider, budget).refresh(search.id);
    assert.equal(result.error, undefined);
    assert.equal(calls.search, 2);
    assert.equal(budget.status().used, 2);
  });

  it('blocks a rent estimate at 45 of 45 and counts an allowed one as 1', async () => {
    const { database, store, budget, search, otherSearch, logRequests } = await setup();
    const { provider, calls } = countingProvider({ pages: 1, estimate: true });
    const job = new RefreshJob(store, provider, budget);
    assert.equal((await job.refresh(search.id)).error, undefined);
    const property = store.listProperties()[0]!;
    store.setFavorite(property.id, true);
    logRequests(44 - budget.status().used, otherSearch().id);
    assert.equal(budget.status().used, 44);

    const api = await serve(database, store, job);
    try {
      const allowed = await fetch(`${api.url}/api/properties/${property.id}/rent-estimate`, {
        method: 'POST',
      });
      assert.equal(allowed.status, 200);
      assert.deepEqual(await allowed.json(), {
        estimate: {
          value: 2300,
          low: 2000,
          high: 2600,
          comps: [
            {
              id: 'mock-rent-comp-1',
              address: '900 Fictional Ave, Miami, FL 33131',
              rent: 2250,
              distanceMi: 0.4,
            },
          ],
        },
      });
      assert.equal(store.getComparableRentFigure(property.id)?.source, 'rent_estimate');
      assert.deepEqual(store.getComparableRentFigure(property.id)?.estimateComps, [
        { address: '900 Fictional Ave, Miami, FL 33131', rent: 2250, distanceMi: 0.4 },
      ]);
      assert.equal(budget.status().used, 45);
      const log = store.listProviderRequestLogs().at(-1)!;
      assert.equal(log.purpose, 'rent-estimate');
      assert.equal(log.propertyId, property.id);
      assert.equal(log.status, 'succeeded');

      const blocked = await fetch(`${api.url}/api/properties/${property.id}/rent-estimate`, {
        method: 'POST',
      });
      assert.equal(blocked.status, 429);
      assert.match(((await blocked.json()) as { error: string }).error, /45 of 45 requests used/);
      assert.equal(calls.estimate, 1);
      assert.equal(budget.status().used, 45);
    } finally {
      await api.close();
    }
  });

  it('reports a provider without rent estimates, or an unknown property, without spending a request', async () => {
    const { database, store, budget, search } = await setup();
    const { provider } = countingProvider({ pages: 1 });
    const job = new RefreshJob(store, provider, budget);
    await job.refresh(search.id);
    const property = store.listProperties()[0]!;
    store.setFavorite(property.id, true);
    const before = budget.status().used;
    const api = await serve(database, store, job);
    try {
      const response = await fetch(`${api.url}/api/properties/${property.id}/rent-estimate`, {
        method: 'POST',
      });
      assert.equal(response.status, 501);
      const missing = await fetch(`${api.url}/api/properties/prop_missing/rent-estimate`, {
        method: 'POST',
      });
      assert.equal(missing.status, 404);
      assert.equal(budget.status().used, before);
    } finally {
      await api.close();
    }
  });

  it('reads and saves the ceiling and billing day through the API', async () => {
    const { database, store, budget } = await setup();
    const job = new RefreshJob(store, countingProvider().provider, budget);
    const api = await serve(database, store, job);
    try {
      const initial = (await (await fetch(`${api.url}/api/request-budget`)).json()) as {
        ceiling: number;
        used: number;
      };
      assert.deepEqual([initial.ceiling, initial.used], [45, 0]);
      const saved = await fetch(`${api.url}/api/request-budget`, {
        method: 'PUT',
        body: JSON.stringify({ ceiling: 30, billingDay: 12 }),
      });
      assert.equal(saved.status, 200);
      assert.equal(budget.status().ceiling, 30);
      assert.equal(budget.status().billingDay, 12);
      const invalid = await fetch(`${api.url}/api/request-budget`, {
        method: 'PUT',
        body: JSON.stringify({ ceiling: -5 }),
      });
      assert.equal(invalid.status, 400);
      assert.equal(budget.status().ceiling, 30);
    } finally {
      await api.close();
    }
  });

  it('summarizes measured refresh usage and monthly projections without provider calls', async () => {
    const { database, store, budget, search, otherSearch } = await setup();
    const rent = otherSearch('Miami · Rent');
    store.pairSavedSearches(search.id, rent.id);
    store.markRefreshSucceeded(search.id, '2026-10-08T12:00:00.000Z');
    store.markRefreshSucceeded(rent.id, '2026-10-08T12:00:00.000Z');
    const log = (purpose: string, savedSearchId: number | undefined, page: number) => {
      const id = store.beginProviderRequest({
        provider: 'test-provider',
        savedSearchId,
        purpose,
        page,
      });
      store.finishProviderRequest(id, { status: 'succeeded', resultCount: 1 });
    };
    for (let page = 1; page <= 2; page += 1) log('saved-search-refresh', search.id, page);
    for (let page = 1; page <= 4; page += 1) log('saved-search-refresh', rent.id, page);
    log('rent-estimate', undefined, 1);
    for (let request = 0; request < 16; request += 1) log('other', undefined, request + 1);
    const { provider, calls } = countingProvider();
    const api = await serve(database, store, new RefreshJob(store, provider, budget));
    try {
      const response = await fetch(`${api.url}/api/request-budget`);
      const usage = (await response.json()) as {
        provider: string;
        requestsPerRefreshAll: number;
        rentEstimatesUsed: number;
        lastSuccessfulRefreshAt: string;
        projections: Record<string, { remainingRuns: number; projected: number }>;
      };
      assert.equal(usage.provider, 'test-provider');
      assert.equal(usage.requestsPerRefreshAll, 6);
      assert.equal(usage.rentEstimatesUsed, 1);
      assert.equal(usage.lastSuccessfulRefreshAt, '2026-10-08T12:00:00.000Z');
      assert.deepEqual(
        [usage.projections.weekly?.remainingRuns, usage.projections.weekly?.projected],
        [3, 42],
      );
      assert.deepEqual(
        [usage.projections.daily?.remainingRuns, usage.projections.daily?.projected],
        [24, 168],
      );
      assert.equal(calls.search, 0);
      assert.equal(calls.estimate, 0);
      assert.equal(budget.status().used, 23);
    } finally {
      await api.close();
    }
  });
});
