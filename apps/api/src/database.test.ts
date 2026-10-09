import initSqlJs, { type Database } from 'sql.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase } from './database.js';
import { createApp } from './app.js';
import { createStore } from './store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function rows(database: Database, sql: string) {
  const statement = database.prepare(sql);
  const result: Record<string, unknown>[] = [];
  while (statement.step()) result.push(statement.getAsObject());
  statement.free();
  return result;
}

async function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-api-'));
  temporaryDirectories.push(directory);
  return openDatabase(join(directory, 'ledgerline.sqlite'));
}

describe('local API bootstrap', () => {
  it('creates an empty SQLite database and applies each numbered migration once', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-api-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'data', 'ledgerline.sqlite');
    const first = await openDatabase(path);
    assert.deepEqual(rows(first, 'SELECT version, name FROM schema_migrations'), [
      { version: 1, name: '001_bootstrap.sql' },
      { version: 2, name: '002_core_schema.sql' },
      { version: 3, name: '003_match_review_undo.sql' },
      { version: 4, name: '004_provider_history.sql' },
      { version: 5, name: '005_refresh_jobs.sql' },
      { version: 6, name: '006_request_budget.sql' },
      { version: 7, name: '007_assumptions.sql' },
      { version: 8, name: '008_property_cost_entries.sql' },
      { version: 9, name: '009_property_risk_details.sql' },
    ]);
    closeDatabase(first);

    const second = await openDatabase(path);
    assert.deepEqual(rows(second, 'SELECT COUNT(*) AS count FROM schema_migrations'), [
      { count: 9 },
    ]);
    closeDatabase(second);
  });

  it('serves health and binds to the loopback interface only', async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    const server = createApp(database);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    try {
      assert.equal(address.address, '127.0.0.1');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      database.close();
    }
  });
});

describe('property cost-entry API', () => {
  it('stores document records, includes them in property detail, and blocks no-flood choices in A/V zones', async () => {
    const database = await temporaryDatabase();
    const store = createStore(database);
    const highRisk = store.createProperty({
      street: '1 Flood Way',
      city: 'Fort Lauderdale',
      zip: '33308',
      floodZone: 'AE',
    });
    const veryHighRisk = store.createProperty({
      street: '3 Surge Way',
      city: 'Miami Beach',
      zip: '33139',
      floodZone: 'VE',
    });
    const outside = store.createProperty({
      street: '2 Dry Way',
      city: 'Tampa',
      zip: '33602',
      floodZone: 'X',
    });
    const server = createApp(database, store);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const root = `http://127.0.0.1:${address.port}`;
    const entry = {
      kind: 'tax_bill',
      amount: 0,
      state: 'Doc',
      source: 'Tax bill · no CDD',
      date: '2026-10-05',
    };
    try {
      const saved = await fetch(`${root}/api/properties/${highRisk.id}/cost-entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      });
      assert.equal(saved.status, 201);
      const details = await fetch(`${root}/api/properties/${highRisk.id}`);
      const body = (await details.json()) as {
        property: { floodZone: string };
        costEntries: Array<{ amount: number; state: string }>;
      };
      assert.equal(body.property.floodZone, 'AE');
      assert.deepEqual(
        body.costEntries.map(({ amount, state }) => ({ amount, state })),
        [{ amount: 0, state: 'Doc' }],
      );
      for (const kind of ['homeowners_quote', 'ho6_quote', 'flood_quote']) {
        const quote = await fetch(`${root}/api/properties/${highRisk.id}/cost-entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind,
            amount: 100,
            state: 'Quote',
            source: 'Carrier',
            date: '2026-10-05',
          }),
        });
        assert.equal(quote.status, 201, await quote.text());
      }
      for (const item of [
        { kind: 'tax_bill_cdd', amount: 450, state: 'Doc', source: 'Tax bill · CDD' },
        { kind: 'association_fee', amount: 325, state: 'Doc', source: 'Association letter' },
        {
          kind: 'special_assessment',
          amount: null,
          amountUnknown: true,
          assessmentStatus: 'pending',
          paymentType: 'installments',
          state: 'Doc',
          source: 'Association letter',
        },
        { kind: 'hoa_none', amount: null, state: 'N/A', source: 'HOA confirmation' },
      ]) {
        const response = await fetch(`${root}/api/properties/${highRisk.id}/cost-entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...item, date: '2026-10-05' }),
        });
        assert.equal(response.status, 201, await response.text());
      }
      const rejected = await fetch(`${root}/api/properties/${highRisk.id}/cost-entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'flood_not_carried',
          state: 'N/A',
          source: 'Owner choice',
          date: '2026-10-05',
        }),
      });
      assert.equal(rejected.status, 400);
      const rejectedVe = await fetch(`${root}/api/properties/${veryHighRisk.id}/cost-entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'flood_not_carried',
          state: 'N/A',
          source: 'Owner choice',
          date: '2026-10-05',
        }),
      });
      assert.equal(rejectedVe.status, 400);
      const allowed = await fetch(`${root}/api/properties/${outside.id}/cost-entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'flood_not_carried',
          state: 'N/A',
          source: 'Owner choice',
          date: '2026-10-05',
        }),
      });
      assert.equal(allowed.status, 201);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe('saved-search API', () => {
  it('creates, updates, pairs, lists, and deletes profiles in SQLite', async () => {
    const database = await temporaryDatabase();
    const server = createApp(database);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const root = `http://127.0.0.1:${address.port}/api/saved-searches`;
    try {
      const buyResponse = await fetch(root, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Miami Buy',
          mode: 'sale',
          location: 'Miami 33131',
          filters: { beds: '2' },
          priceMin: 250000,
          priceMax: 900000,
        }),
      });
      assert.equal(buyResponse.status, 201, await buyResponse.clone().text());
      const buy = (
        (await buyResponse.json()) as { item: { id: number; refreshIntervalDays: null } }
      ).item;
      assert.equal(buy.refreshIntervalDays, null);
      const rentResponse = await fetch(root, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Miami Rent', mode: 'rent', location: 'Miami 33131' }),
      });
      const rent = ((await rentResponse.json()) as { item: { id: number } }).item;
      const pairResponse = await fetch(`${root}/${buy.id}/pair`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairedSearchId: rent.id }),
      });
      assert.equal(pairResponse.status, 200);
      const updateResponse = await fetch(`${root}/${buy.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Miami shortlist', refreshIntervalDays: 7 }),
      });
      assert.equal(updateResponse.status, 200);
      const listingResponse = await fetch(root);
      const items = (
        (await listingResponse.json()) as {
          items: Array<{ name: string; pairedSearchId: number | null }>;
        }
      ).items;
      assert.equal(items[0].name, 'Miami shortlist');
      assert.equal(items[0].pairedSearchId, rent.id);
      assert.equal(items[1].pairedSearchId, buy.id);
      const deleteResponse = await fetch(`${root}/${rent.id}`, { method: 'DELETE' });
      assert.equal(deleteResponse.status, 204);
      const afterDelete = (
        (await (await fetch(root)).json()) as { items: Array<{ pairedSearchId: number | null }> }
      ).items;
      assert.equal(afterDelete.length, 1);
      assert.equal(afterDelete[0].pairedSearchId, null);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      closeDatabase(database);
    }
  });

  it('rejects invalid filters, price ranges, and cross-area pairing', async () => {
    const database = await temporaryDatabase();
    const server = createApp(database);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const root = `http://127.0.0.1:${address.port}/api/saved-searches`;
    try {
      const invalid = await fetch(root, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad',
          mode: 'sale',
          location: 'Miami',
          priceMin: 900,
          priceMax: 100,
        }),
      });
      assert.equal(invalid.status, 400);
      const create = async (mode: string, location: string) => {
        const response = await fetch(root, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: mode, mode, location }),
        });
        return ((await response.json()) as { item: { id: number } }).item.id;
      };
      const buyId = await create('sale', 'Miami');
      const rentId = await create('rent', 'Fort Lauderdale');
      const pair = await fetch(`${root}/${buyId}/pair`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairedSearchId: rentId }),
      });
      assert.equal(pair.status, 400);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      closeDatabase(database);
    }
  });
});

describe('property detail API', () => {
  it('returns normalized listing history and local snapshots without raw provider payloads', async () => {
    const database = await temporaryDatabase();
    const store = createStore(database);
    const property = store.createProperty({
      street: '2207 NE 32nd Ct',
      city: 'Fort Lauderdale',
      zip: '33308',
      propertyType: 'single_family',
      beds: 3,
      bathsTotal: 2,
      livingAreaSqft: 1850,
      lotSizeSqft: 9148,
      yearBuilt: 1964,
    });
    const [listing] = store.replaceListings(property.id, [
      {
        provider: 'mock',
        providerId: 'detail-sale',
        mode: 'sale',
        price: 849000,
        pricePeriod: 'total',
        status: 'active',
        providerHistory: [{ date: '2026-10-01', price: 859000, status: 'active' }],
      },
    ]);
    store.addSnapshot(listing.id, {
      fetchedAt: '2026-10-06T12:00:00.000Z',
      price: 849000,
      status: 'active',
    });
    store.addRawPayload(listing.id, { privateDebugData: 'never returned' });
    const server = createApp(database, store);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/properties/${property.id}`,
      );
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        property: { lotSizeSqft: number };
        listings: Array<{
          providerHistory: Array<{ price: number }>;
          localSnapshots: Array<{ price: number }>;
          privateDebugData?: string;
        }>;
      };
      assert.equal(result.property.lotSizeSqft, 9148);
      assert.equal(result.listings[0].providerHistory[0].price, 859000);
      assert.equal(result.listings[0].localSnapshots[0].price, 849000);
      assert.equal(result.listings[0].privateDebugData, undefined);
      assert.equal(
        (await fetch(`http://127.0.0.1:${address.port}/api/properties/prop_missing`)).status,
        404,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      database.close();
    }
  });
});

describe('property shortlist API', () => {
  it('saves and dismisses a property, manages notes, and keeps them after an API restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-property-api-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'ledgerline.sqlite');
    let database = await openDatabase(databasePath);
    let store = createStore(database);
    const property = store.createProperty({
      street: '2207 NE 32nd Ct',
      city: 'Fort Lauderdale',
      zip: '33308',
    });
    store.replaceListings(property.id, [
      {
        provider: 'mock',
        providerId: 'sale-home',
        mode: 'sale',
        price: 849000,
        pricePeriod: 'total',
        status: 'active',
      },
      {
        provider: 'mock',
        providerId: 'rent-home',
        mode: 'rent',
        price: 5200,
        pricePeriod: 'month',
        status: 'active',
      },
    ]);

    const start = async (
      activeDatabase: typeof database,
      activeStore: ReturnType<typeof createStore>,
    ) => {
      const server = createApp(activeDatabase, activeStore);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
      return { server, root: `http://127.0.0.1:${address.port}/api` };
    };
    const stop = async (server: ReturnType<typeof createApp>) =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    let { server, root } = await start(database, store);
    try {
      const getProperty = async () =>
        (await fetch(`${root}/properties/${property.id}`)).json() as Promise<{
          listings: Array<{ mode: string }>;
          notes: Array<{ id: number; body: string; createdAt: string; updatedAt: string }>;
          saved: boolean;
          dismissed: boolean;
        }>;
      let detail = await getProperty();
      assert.deepEqual(detail.listings.map((listing) => listing.mode).sort(), ['rent', 'sale']);

      assert.equal(
        (
          await fetch(`${root}/properties/${property.id}/favorite`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ saved: true }),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${root}/properties/${property.id}/dismissal`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dismissed: true }),
          })
        ).status,
        200,
      );
      const hidden = (await (await fetch(`${root}/listings?mode=sale`)).json()) as {
        items: unknown[];
      };
      assert.equal(hidden.items.length, 0);
      const shown = (await (
        await fetch(`${root}/listings?mode=sale&showDismissed=true&savedOnly=true`)
      ).json()) as { items: Array<{ saved: boolean; dismissed: boolean }> };
      assert.deepEqual(
        shown.items.map(({ saved, dismissed }) => [saved, dismissed]),
        [[true, true]],
      );

      const added = await fetch(`${root}/properties/${property.id}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Check the roof' }),
      });
      assert.equal(added.status, 201);
      const note = (
        (await added.json()) as { note: { id: number; createdAt: string; updatedAt: string } }
      ).note;
      assert.ok(note.createdAt);
      const edited = await fetch(`${root}/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Roof is 2020' }),
      });
      assert.equal(edited.status, 200);
      detail = await getProperty();
      assert.equal(detail.notes[0].body, 'Roof is 2020');
      assert.ok(detail.notes[0].updatedAt >= note.updatedAt);

      await stop(server);
      closeDatabase(database);
      database = await openDatabase(databasePath);
      store = createStore(database);
      ({ server, root } = await start(database, store));
      detail = await getProperty();
      assert.equal(detail.saved, true);
      assert.equal(detail.dismissed, true);
      assert.equal(detail.notes[0].body, 'Roof is 2020');
      const deleted = await fetch(`${root}/notes/${note.id}`, { method: 'DELETE' });
      assert.equal(deleted.status, 204);
      assert.equal((await getProperty()).notes.length, 0);
    } finally {
      await stop(server);
      closeDatabase(database);
    }
  });
});
