import type { Database } from 'sql.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase, persistDatabase } from './database.js';
import { createStore, type ListingInput, type Store } from './store.js';

const directories: string[] = [];
let database: Database;
let store: Store;
let path: string;

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-store-'));
  directories.push(directory);
  path = join(directory, 'ledgerline.sqlite');
  database = await openDatabase(path);
  store = createStore(database, { afterWrite: () => persistDatabase(database) });
});

afterEach(() => {
  try {
    closeDatabase(database);
  } catch {
    // Already closed by the test.
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function rows(sql: string) {
  const statement = database.prepare(sql);
  const result: Record<string, unknown>[] = [];
  while (statement.step()) result.push(statement.getAsObject());
  statement.free();
  return result;
}

const address = { street: '2207 NE 32nd Ct', city: 'Fort Lauderdale', zip: '33308' };

const saleListing: ListingInput = {
  provider: 'mock',
  providerId: 'sale-1',
  mode: 'sale',
  price: 849000,
  pricePeriod: 'total',
  status: 'active',
  sample: true,
};

const rentListing: ListingInput = {
  provider: 'mock',
  providerId: 'rent-1',
  mode: 'rent',
  price: 5200,
  pricePeriod: 'month',
  status: 'active',
  sample: true,
};

describe('migrations', () => {
  it('create every core table on an empty database file, and rerunning them changes nothing', async () => {
    const tables = [
      'properties',
      'listings',
      'listing_snapshots',
      'listing_raw_payloads',
      'property_notes',
      'property_favorites',
      'property_dismissals',
      'saved_searches',
      'match_review_queue',
    ];
    const schema = () =>
      rows(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      );
    const names = schema().map((row) => row.name);
    for (const table of tables) assert.ok(names.includes(table), `missing table ${table}`);

    const before = schema();
    const migrationRows = rows('SELECT version, name, applied_at FROM schema_migrations');
    closeDatabase(database);

    database = await openDatabase(path);
    assert.deepEqual(schema(), before);
    assert.deepEqual(
      rows('SELECT version, name, applied_at FROM schema_migrations'),
      migrationRows,
    );
  });

  it('keep foreign keys on after the file is saved', () => {
    persistDatabase(database);
    assert.deepEqual(rows('PRAGMA foreign_keys'), [{ foreign_keys: 1 }]);
  });
});

describe('properties', () => {
  it('stores the normalized fields and finds a property by exact address and unit', () => {
    const house = store.createProperty({
      ...address,
      county: 'Broward',
      latitude: 26.15,
      longitude: -80.12,
      propertyType: 'single_family',
      beds: 3,
      bathsTotal: 2.5,
      bathsFull: 2,
      bathsHalf: 1,
      livingAreaSqft: 1850,
      lotSizeSqft: 9148,
      yearBuilt: 1964,
      parcelId: '494234-01-0010',
      sample: true,
    });
    assert.match(house.id, /^prop_/);
    assert.equal(house.unit, null);
    assert.equal(house.bathsHalf, 1);
    assert.equal(house.sample, true);
    assert.deepEqual(store.getProperty(house.id), house);
    assert.equal(store.findPropertyByAddress(address)?.id, house.id);
    assert.equal(store.findPropertyByAddress({ ...address, unit: '1204' }), null);
  });

  it('refuses a second property at the same normalized address and unit', () => {
    store.createProperty(address);
    assert.throws(() => store.createProperty(address));
    const unit = store.createProperty({ ...address, unit: '1204' });
    assert.equal(store.findPropertyByAddress({ ...address, unit: '1204' })?.id, unit.id);
    assert.equal(store.findPropertiesOnStreetAddress(address).length, 2);
  });
});

describe('listings', () => {
  it('lets one property hold both a sale listing and a rent listing', () => {
    const house = store.createProperty(address);
    store.replaceListings(house.id, [saleListing, rentListing]);
    const listings = store.listListings(house.id);
    assert.deepEqual(listings.map((listing) => listing.mode).sort(), ['rent', 'sale']);
    assert.ok(listings.every((listing) => listing.propertyId === house.id));
  });

  it('round-trips the listing fields', () => {
    const house = store.createProperty(address);
    const [listing] = store.replaceListings(house.id, [
      {
        ...saleListing,
        mlsName: 'MIAMI',
        mlsNumber: 'A123',
        hoaFee: 0,
        imageUrls: ['https://example.test/1.jpg'],
        sourceUrl: 'https://example.test/listing',
        agentName: 'A. Agent',
        officeName: 'Office',
        providerListedDate: '2026-08-20',
        providerLastSeenDate: '2026-10-06',
        fieldQuality: { hoaFee: 'missing' },
      },
    ]);
    assert.match(listing.id, /^lst_/);
    assert.equal(listing.hoaFee, 0);
    assert.deepEqual(listing.imageUrls, ['https://example.test/1.jpg']);
    assert.deepEqual(listing.fieldQuality, { hoaFee: 'missing' });
    assert.equal(listing.firstFetchedAt, listing.lastFetchedAt);
    assert.equal(listing.sample, true);
  });

  it('rejects a bad mode and a listing for an unknown property', () => {
    const house = store.createProperty(address);
    assert.throws(() =>
      store.replaceListings(house.id, [{ ...saleListing, mode: 'lease' as never }]),
    );
    assert.throws(
      () => store.replaceListings('prop_missing', [saleListing]),
      /Unknown property ID/,
    );
    assert.deepEqual(store.listListings(house.id), []);
  });

  it('keeps the first-fetched time when a listing is refreshed', () => {
    let tick = 0;
    store = createStore(database, { clock: () => new Date(Date.UTC(2026, 9, 8, 12, tick++)) });
    const house = store.createProperty(address);
    const first = store.upsertListing(house.id, saleListing);
    const second = store.upsertListing(house.id, { ...saleListing, price: 829000 });
    assert.equal(second.id, first.id);
    assert.equal(second.price, 829000);
    assert.equal(second.firstFetchedAt, first.firstFetchedAt);
    assert.notEqual(second.lastFetchedAt, first.lastFetchedAt);
    assert.equal(store.listListings(house.id).length, 1);
  });

  it('refuses to move a provider listing to another property', () => {
    const house = store.createProperty(address);
    const other = store.createProperty({ ...address, unit: '2' });
    store.upsertListing(house.id, saleListing);
    assert.throws(() => store.upsertListing(other.id, saleListing), /another property/);
  });
});

describe('local listing search', () => {
  it('filters mode, location, price, facts and type; defaults to active and hides dismissed', () => {
    const house = store.createProperty({
      ...address,
      county: 'Broward',
      beds: 3,
      bathsTotal: 2,
      livingAreaSqft: 1850,
      propertyType: 'single_family',
    });
    store.replaceListings(house.id, [{ ...saleListing, providerLastSeenDate: '2026-10-06' }]);
    const rent = store.createProperty({
      ...address,
      street: '2208 NE 32nd Ct',
      beds: 2,
      bathsTotal: 1,
      livingAreaSqft: 900,
      propertyType: 'condo',
    });
    store.replaceListings(rent.id, [
      { ...rentListing, providerId: 'rent-two', price: 2800, providerLastSeenDate: '2026-10-07' },
    ]);
    const pending = store.createProperty({
      ...address,
      street: '2209 NE 32nd Ct',
      beds: 3,
      bathsTotal: 2,
      livingAreaSqft: 1600,
      propertyType: 'single_family',
    });
    store.replaceListings(pending.id, [
      { ...saleListing, providerId: 'pending-one', status: 'pending', price: 650000 },
    ]);
    const dismissed = store.createProperty({
      ...address,
      street: '2210 NE 32nd Ct',
      beds: 3,
      bathsTotal: 2,
      livingAreaSqft: 1800,
      propertyType: 'single_family',
    });
    store.replaceListings(dismissed.id, [
      { ...saleListing, providerId: 'dismissed-one', price: 600000 },
    ]);
    store.setDismissed(dismissed.id, true);
    store.setFavorite(house.id, true);

    assert.deepEqual(
      store.searchListings({ mode: 'sale' }).map(({ listing }) => listing.providerId),
      ['sale-1'],
    );
    assert.deepEqual(
      store.searchListings({ mode: 'rent' }).map(({ listing }) => listing.providerId),
      ['rent-two'],
    );
    assert.deepEqual(
      store.searchListings({ mode: 'sale', savedOnly: true }).map(({ property }) => property.id),
      [house.id],
    );
    assert.deepEqual(
      store
        .searchListings({ mode: 'sale', showDismissed: true })
        .map(({ property }) => property.id)
        .sort(),
      [house.id, dismissed.id].sort(),
    );
    assert.deepEqual(
      store
        .searchListings({
          mode: 'sale',
          location: '33308',
          priceMin: 500000,
          priceMax: 900000,
          beds: 3,
          baths: 2,
          propertyType: 'single_family',
          minSqft: 1800,
        })
        .map(({ listing }) => listing.providerId),
      ['sale-1'],
    );
    assert.deepEqual(
      store
        .searchListings({ mode: 'sale', statuses: ['active', 'pending'], sort: 'price' })
        .map(({ listing }) => listing.providerId),
      ['pending-one', 'sale-1'],
    );
  });
});

describe('snapshots and raw payloads', () => {
  it('records price and status per fetch, oldest first', () => {
    const house = store.createProperty(address);
    const [listing] = store.replaceListings(house.id, [saleListing]);
    store.addSnapshot(listing.id, {
      fetchedAt: '2026-10-02T00:00:00.000Z',
      price: 849000,
      status: 'active',
    });
    store.addSnapshot(listing.id, {
      fetchedAt: '2026-10-01T00:00:00.000Z',
      price: 859000,
      status: 'active',
    });
    assert.deepEqual(
      store.listSnapshots(listing.id).map((snapshot) => snapshot.price),
      [859000, 849000],
    );
    assert.throws(
      () => store.addSnapshot('lst_missing', { price: 1, status: 'active' }),
      /Unknown listing ID/,
    );
  });

  it('keeps raw payloads in their own table, away from the listing record', () => {
    const house = store.createProperty(address);
    const [listing] = store.replaceListings(house.id, [saleListing]);
    store.addRawPayload(listing.id, { providerField: 'x' }, '2026-10-02T00:00:00.000Z');
    assert.deepEqual(store.listRawPayloads(listing.id), [
      { id: 1, fetchedAt: '2026-10-02T00:00:00.000Z', payload: { providerField: 'x' } },
    ]);
    assert.ok(!JSON.stringify(store.getListing(listing.id)).includes('providerField'));
    const columns = rows('PRAGMA table_info(listings)').map((row) => row.name);
    assert.ok(!columns.some((name) => /raw|payload/i.test(String(name))));
  });

  it('removes snapshots and raw payloads along with a replaced listing', () => {
    const house = store.createProperty(address);
    const [listing] = store.replaceListings(house.id, [saleListing]);
    store.addSnapshot(listing.id, { price: 1, status: 'active' });
    store.addRawPayload(listing.id, {});
    store.replaceListings(house.id, []);
    assert.deepEqual(rows('SELECT COUNT(*) AS n FROM listing_snapshots'), [{ n: 0 }]);
    assert.deepEqual(rows('SELECT COUNT(*) AS n FROM listing_raw_payloads'), [{ n: 0 }]);
  });
});

describe('personal data', () => {
  it('saves a note, favorite, or dismissal only against a property ID, never a listing ID', () => {
    const house = store.createProperty(address);
    const [listing] = store.replaceListings(house.id, [saleListing]);
    for (const id of [listing.id, 'prop_missing', 'missing']) {
      assert.throws(() => store.addNote(id, 'x'), /Unknown property ID/);
      assert.throws(() => store.setFavorite(id, true), /Unknown property ID/);
      assert.throws(() => store.setDismissed(id, true), /Unknown property ID/);
    }
    assert.deepEqual(rows('SELECT COUNT(*) AS n FROM property_notes'), [{ n: 0 }]);
    assert.deepEqual(rows('SELECT COUNT(*) AS n FROM property_favorites'), [{ n: 0 }]);
    assert.deepEqual(rows('SELECT COUNT(*) AS n FROM property_dismissals'), [{ n: 0 }]);
  });

  it('is rejected by the database itself, not just the module', () => {
    const house = store.createProperty(address);
    const [listing] = store.replaceListings(house.id, [saleListing]);
    for (const table of ['property_favorites', 'property_dismissals']) {
      assert.throws(() =>
        database.run(`INSERT INTO ${table} VALUES (?, '2026-10-08')`, [listing.id]),
      );
    }
    assert.throws(() =>
      database.run(
        "INSERT INTO property_notes (property_id, body, created_at, updated_at) VALUES (?, 'x', 'a', 'a')",
        [listing.id],
      ),
    );
  });

  it('adds, edits, lists, and deletes notes; toggles favorite and dismissal', () => {
    const house = store.createProperty(address);
    const note = store.addNote(house.id, 'Ask about the roof');
    store.addNote(house.id, 'Second note');
    store.updateNote(note.id, 'Roof is 2020');
    assert.deepEqual(
      store.listNotes(house.id).map((entry) => entry.body),
      ['Roof is 2020', 'Second note'],
    );
    store.deleteNote(note.id);
    assert.equal(store.listNotes(house.id).length, 1);

    assert.equal(store.isFavorite(house.id), false);
    store.setFavorite(house.id, true);
    store.setFavorite(house.id, true);
    assert.equal(store.isFavorite(house.id), true);
    store.setFavorite(house.id, false);
    assert.equal(store.isFavorite(house.id), false);

    store.setDismissed(house.id, true);
    assert.equal(store.isDismissed(house.id), true);
    store.setDismissed(house.id, false);
    assert.equal(store.isDismissed(house.id), false);
  });

  it('survives replacing the property listings', () => {
    const house = store.createProperty(address);
    store.replaceListings(house.id, [saleListing]);
    store.addNote(house.id, 'Keep me');
    store.setFavorite(house.id, true);
    store.setDismissed(house.id, true);

    store.replaceListings(house.id, [
      { ...saleListing, provider: 'other', providerId: 'x-9' },
      rentListing,
    ]);
    store.replaceListings(house.id, []);

    assert.deepEqual(
      store.listNotes(house.id).map((entry) => entry.body),
      ['Keep me'],
    );
    assert.equal(store.isFavorite(house.id), true);
    assert.equal(store.isDismissed(house.id), true);
    assert.equal(store.getProperty(house.id)?.street, address.street);
  });
});

describe('saved searches', () => {
  it('stores mode, location, filters, price range, and an undecided refresh interval', () => {
    const search = store.createSavedSearch({
      name: 'Fort Lauderdale buy',
      mode: 'sale',
      location: 'Fort Lauderdale 33308',
      filters: { beds: 3, type: ['single_family'] },
      priceMin: 500000,
      priceMax: 900000,
    });
    assert.deepEqual(search.filters, { beds: 3, type: ['single_family'] });
    assert.equal(search.refreshIntervalDays, null);
    assert.equal(search.pairedSearchId, null);
    assert.deepEqual(store.listSavedSearches(), [search]);
  });

  it('pairs a Buy search with a Rent search in both directions', () => {
    const buy = store.createSavedSearch({ name: 'Buy', mode: 'sale', location: 'Miami 33131' });
    const rent = store.createSavedSearch({ name: 'Rent', mode: 'rent', location: 'Miami 33131' });
    const otherBuy = store.createSavedSearch({
      name: 'Buy 2',
      mode: 'sale',
      location: 'Miami 33132',
    });
    assert.throws(
      () => store.pairSavedSearches(buy.id, otherBuy.id),
      /one Buy search and one Rent search/,
    );
    store.pairSavedSearches(buy.id, rent.id);
    assert.equal(store.getSavedSearch(buy.id)?.pairedSearchId, rent.id);
    assert.equal(store.getSavedSearch(rent.id)?.pairedSearchId, buy.id);
    store.deleteSavedSearch(rent.id);
    assert.equal(store.getSavedSearch(buy.id)?.pairedSearchId, null);
  });

  it('updates a saved search and only pairs searches that cover the same area', () => {
    const buy = store.createSavedSearch({ name: 'Buy', mode: 'sale', location: 'Miami 33131' });
    const rent = store.createSavedSearch({ name: 'Rent', mode: 'rent', location: 'Miami 33131' });
    store.pairSavedSearches(buy.id, rent.id);
    const renamed = store.updateSavedSearch(buy.id, {
      name: 'Miami shortlist',
      refreshIntervalDays: 7,
    });
    assert.equal(renamed.name, 'Miami shortlist');
    assert.equal(renamed.refreshIntervalDays, 7);
    assert.throws(
      () => store.updateSavedSearch(buy.id, { location: 'Miami 33132' }),
      /Update or unpair/,
    );
    store.unpairSavedSearch(buy.id);
    assert.equal(store.getSavedSearch(buy.id)?.pairedSearchId, null);
    assert.equal(store.getSavedSearch(rent.id)?.pairedSearchId, null);
  });

  it('rejects an inverted price range and a non-positive refresh interval', () => {
    assert.throws(() =>
      store.createSavedSearch({ name: 'x', mode: 'sale', location: 'y', priceMin: 2, priceMax: 1 }),
    );
    assert.throws(() =>
      store.createSavedSearch({ name: 'x', mode: 'sale', location: 'y', refreshIntervalDays: 0 }),
    );
  });
});

describe('match review queue', () => {
  const incoming = {
    provider: 'mock',
    sourceId: 'bay-rent',
    property: {
      street: '1500 Bay Rd',
      unit: '1204',
      city: 'Miami Beach',
      zip: '33139',
    },
    listing: {
      mode: 'rent' as const,
      price: 3400,
      pricePeriod: 'month' as const,
      status: 'active',
    },
    rawPayload: {},
  };

  it('holds an ambiguous incoming listing until it is decided, creating nothing', () => {
    const existing = store.createProperty({
      street: '1500 Bay Rd',
      city: 'Miami Beach',
      zip: '33139',
    });
    store.addNote(existing.id, 'Looked at this one');
    const item = store.enqueueMatchReview({
      incomingListing: incoming,
      candidatePropertyId: existing.id,
      reason: 'same street address; unit missing on existing record',
    });
    assert.equal(item.decision, null);
    assert.equal(item.decidedAt, null);
    assert.deepEqual(item.incomingListing, incoming);
    assert.equal(store.listProperties().length, 1);
    assert.equal(store.listPendingMatchReviews().length, 1);

    const decided = store.decideMatchReview(item.id, 'keep_separate');
    assert.equal(decided.decision, 'keep_separate');
    assert.ok(decided.decidedAt);
    assert.equal(store.listPendingMatchReviews().length, 0);
    assert.throws(() => store.decideMatchReview(item.id, 'link'), /already decided/);
  });

  it('only queues against a stored property', () => {
    assert.throws(
      () =>
        store.enqueueMatchReview({
          incomingListing: incoming,
          candidatePropertyId: 'prop_missing',
          reason: 'x',
        }),
      /Unknown property ID/,
    );
  });
});

describe('persistence', () => {
  it('writes through to the database file after each change', async () => {
    const house = store.createProperty(address);
    store.addNote(house.id, 'Saved to disk');
    store.setFavorite(house.id, true);
    store.setDismissed(house.id, true);
    closeDatabase(database);

    database = await openDatabase(path);
    store = createStore(database);
    assert.deepEqual(
      store.listNotes(house.id).map((entry) => entry.body),
      ['Saved to disk'],
    );
    assert.equal(store.isFavorite(house.id), true);
    assert.equal(store.isDismissed(house.id), true);
  });

  it('rolls a failed change back completely', () => {
    const house = store.createProperty(address);
    store.replaceListings(house.id, [saleListing]);
    assert.throws(() =>
      store.replaceListings(house.id, [
        rentListing,
        { ...rentListing, mode: 'lease' as never, providerId: 'r2' },
      ]),
    );
    assert.deepEqual(
      store.listListings(house.id).map((listing) => listing.providerId),
      ['sale-1'],
    );
  });
});

describe('web client boundary', () => {
  it('has no code that reads the raw payload table', () => {
    const webSource = fileURLToPath(new URL('../../web/src/', import.meta.url));
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const full = join(directory, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx)$/.test(name)) files.push(full);
      }
    };
    walk(webSource);
    assert.ok(files.length > 0, 'expected web source files to scan');
    for (const file of files) {
      assert.doesNotMatch(
        readFileSync(file, 'utf8'),
        /raw_?payload|listRawPayloads|addRawPayload|\bsql\b/i,
        `${file} must not touch raw payloads or SQL`,
      );
    }
  });
});
