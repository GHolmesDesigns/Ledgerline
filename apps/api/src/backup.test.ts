import type { Database } from 'sql.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupError,
  exportBackup,
  importBackup,
} from './backup.js';
import { createApp } from './app.js';
import { closeDatabase, openDatabase, persistDatabase } from './database.js';
import { importProviderListings } from './providers/import-listings.js';
import { MockListingProvider } from './providers/mock-provider.js';
import { createStore, type Store } from './store.js';

const directories: string[] = [];
const databases: Database[] = [];
const exportedAt = new Date(Date.UTC(2026, 9, 8, 15, 0));

afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      closeDatabase(database);
    } catch {
      // Already closed by the test.
    }
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function freshStore() {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-backup-'));
  directories.push(directory);
  const database = await openDatabase(join(directory, 'ledgerline.sqlite'));
  databases.push(database);
  let tick = 0;
  const store = createStore(database, {
    clock: () => new Date(Date.UTC(2026, 9, 8, 12, tick++)),
    afterWrite: () => persistDatabase(database),
  });
  return { database, store };
}

const bayRoad = { street: '1500 Bay Rd', city: 'Miami Beach', zip: '33139', sample: true };

// Personal data on real mock-provider properties: notes, a save, a dismissal, a Buy/Rent
// search pair, and one match decision (the Bay Road unit that waits for review).
async function seedPersonalData(store: Store, decision: 'link' | 'keep_separate') {
  const existing = store.createProperty({
    ...bayRoad,
    county: 'Miami-Dade',
    latitude: 25.7907,
    longitude: -80.1423,
  });
  store.addNote(existing.id, 'Ask the association about the roof assessment');
  await importProviderListings(new MockListingProvider(), store);

  const properties = store.listProperties();
  const fortLauderdale = properties.find((property) => property.street.includes('32nd'))!;
  const other = properties.find(
    (property) => property.id !== fortLauderdale.id && property.id !== existing.id,
  )!;
  store.addNote(fortLauderdale.id, 'Quiet street, check flood zone');
  store.addNote(fortLauderdale.id, 'Roof is from 2020');
  store.setFavorite(fortLauderdale.id, true);
  store.setDismissed(other.id, true);

  const buy = store.createSavedSearch({
    name: 'Fort Lauderdale buy',
    mode: 'sale',
    location: 'Fort Lauderdale 33308',
    filters: { beds: '3' },
    priceMin: 400000,
    priceMax: 900000,
    refreshIntervalDays: 7,
  });
  const rent = store.createSavedSearch({
    name: 'Fort Lauderdale rent',
    mode: 'rent',
    location: 'Fort Lauderdale 33308',
  });
  store.setPersonalAssumptions(buy.id, {
    downPaymentPct: 25,
    mortgageRatePct: 6.25,
    termYears: 20,
    maintenancePctPerYear: 1.2,
    updatedAt: '2026-10-08T11:00:00.000Z',
  });
  store.setLocalAssumption({
    county: 'Broward',
    set: true,
    millage: 19.5,
    typicalNonAdValoremPerYear: 700,
    homeownersDefaultMonthly: 520,
    ho6DefaultMonthly: 110,
    floodDefaultMonthly: { X: 50, AE: 180, VE: 420 },
    source: 'county tax collector',
    setOn: '2026-10-07',
    sample: true,
  });
  store.setLocalAssumption({
    county: 'Palm Beach',
    set: false,
    millage: null,
    typicalNonAdValoremPerYear: null,
    homeownersDefaultMonthly: null,
    ho6DefaultMonthly: null,
    floodDefaultMonthly: {},
    source: null,
    setOn: null,
    sample: false,
  });
  store.pairSavedSearches(buy.id, rent.id);

  const [review] = store.listPendingMatchReviews();
  assert.ok(review, 'the Bay Road listing waits for review');
  store.decideMatchReview(review.id, decision);
  return { existing, fortLauderdale, other };
}

describe('personal-data backup', () => {
  it('round-trips notes, saves, dismissals, saved searches, and match decisions into an empty database', async () => {
    const source = await freshStore();
    await seedPersonalData(source.store, 'keep_separate');
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store, exportedAt)));

    assert.equal(backup.format, BACKUP_FORMAT);
    assert.equal(backup.formatVersion, BACKUP_VERSION);
    assert.equal(backup.exportedAt, exportedAt.toISOString());

    const target = await freshStore();
    const report = importBackup(target.store, backup);

    assert.deepEqual(report.skipped, []);
    assert.equal(report.added.notes, 3);
    assert.equal(report.added.saved, 1);
    assert.equal(report.added.dismissed, 1);
    assert.equal(report.added.savedSearches, 2);
    assert.equal(report.added.matchDecisions, 1);
    assert.equal(report.added.personalAssumptions, 2);
    assert.equal(report.added.localAssumptions, 2);
    // The restored database re-exports to exactly the same file.
    assert.deepEqual(
      exportBackup(target.store, exportedAt),
      exportBackup(source.store, exportedAt),
    );

    const pair = target.store.listSavedSearches();
    assert.equal(pair[0]!.pairedSearchId, pair[1]!.id);
    assert.equal(pair[0]!.refreshIntervalDays, 7);
    assert.equal(target.store.getPersonalAssumptions(pair[0]!.id)?.mortgageRatePct, 6.25);
    assert.deepEqual(target.store.listLocalAssumptions(), source.store.listLocalAssumptions());
    const restoredBay = target.store.findPropertyByAddress({ ...bayRoad, unit: null })!;
    assert.deepEqual([restoredBay.latitude, restoredBay.longitude], [25.7907, -80.1423]);
    assert.equal(restoredBay.county, 'Miami-Dade');
    const fortLauderdale = target.store
      .listProperties()
      .find((property) => property.street.includes('32nd'))!;
    assert.equal(target.store.isFavorite(fortLauderdale.id), true);
    assert.deepEqual(
      target.store.listNotes(fortLauderdale.id).map((note) => note.body),
      ['Quiet street, check flood zone', 'Roof is from 2020'],
    );
  });

  it('creates no duplicates when the same file is imported twice', async () => {
    const source = await freshStore();
    await seedPersonalData(source.store, 'link');
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store, exportedAt)));

    const target = await freshStore();
    importBackup(target.store, backup);
    const afterFirst = exportBackup(target.store, exportedAt);
    const propertyCount = target.store.listProperties().length;
    const searchCount = target.store.listSavedSearches().length;

    const second = importBackup(target.store, backup);
    assert.deepEqual(second.added, {
      properties: 0,
      notes: 0,
      saved: 0,
      dismissed: 0,
      savedSearches: 0,
      matchDecisions: 0,
      personalAssumptions: 0,
      localAssumptions: 0,
    });
    assert.equal(second.alreadyPresent.notes, 3);
    assert.equal(second.alreadyPresent.savedSearches, 2);
    assert.equal(second.alreadyPresent.matchDecisions, 1);
    assert.deepEqual(exportBackup(target.store, exportedAt), afterFirst);
    assert.equal(target.store.listProperties().length, propertyCount);
    assert.equal(target.store.listSavedSearches().length, searchCount);
  });

  it('merges into an existing database by normalized address and unit', async () => {
    const source = await freshStore();
    const original = source.store.createProperty({
      street: '2207 NE 32nd Ct',
      city: 'Fort Lauderdale',
      zip: '33308',
      county: 'Broward',
    });
    source.store.addNote(original.id, 'From the backup');
    const unit = source.store.createProperty({
      street: '1500 Bay Rd',
      unit: '1204',
      city: 'Miami Beach',
      zip: '33139',
    });
    source.store.setFavorite(unit.id, true);
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store, exportedAt)));

    const target = await freshStore();
    // The same address spelled differently, and the same street without the unit.
    const existing = target.store.createProperty({
      street: '2207 Northeast 32nd Court',
      city: 'fort lauderdale',
      zip: '33308',
    });
    target.store.addNote(existing.id, 'Already here');
    const noUnit = target.store.createProperty({ ...bayRoad });

    const report = importBackup(target.store, backup);
    assert.equal(report.alreadyPresent.properties, 1);
    assert.equal(report.added.properties, 1);
    assert.equal(target.store.listProperties().length, 3);
    assert.deepEqual(
      target.store.listNotes(existing.id).map((note) => note.body),
      ['Already here', 'From the backup'],
    );
    // A different unit is a different property, never merged into the no-unit one.
    assert.equal(target.store.isFavorite(noUnit.id), false);
    assert.equal(
      target.store.isFavorite(
        target.store.findPropertyByAddress({
          street: '1500 Bay Rd',
          unit: '1204',
          city: 'Miami Beach',
          zip: '33139',
        })!.id,
      ),
      true,
    );
  });

  it('exports no listing price, snapshot, raw payload, or credential', async () => {
    const source = await freshStore();
    await seedPersonalData(source.store, 'link');
    const text = JSON.stringify(exportBackup(source.store, exportedAt));

    const listings = source.store
      .listProperties()
      .flatMap((property) => source.store.listListings(property.id));
    assert.ok(listings.length > 0 && listings.some((listing) => listing.price));
    for (const listing of listings) {
      if (listing.price) assert.equal(text.includes(String(listing.price)), false);
      for (const payload of source.store.listRawPayloads(listing.id)) {
        assert.equal(text.includes(JSON.stringify(payload.payload).slice(1, 40)), false);
      }
    }
    for (const forbidden of [
      '"price"',
      '"pricePeriod"',
      '"rawPayload"',
      '"payload"',
      '"snapshots"',
      '"listings"',
      '"imageUrls"',
      '"agentEmail"',
      'apiKey',
      'api_key',
      'credential',
    ]) {
      assert.equal(text.includes(forbidden), false, `export must not contain ${forbidden}`);
    }
  });

  it('applies a restored Link decision when the listing is fetched again', async () => {
    const source = await freshStore();
    await seedPersonalData(source.store, 'link');
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store, exportedAt)));

    const target = await freshStore();
    importBackup(target.store, backup);
    assert.equal(target.store.listPendingMatchReviews().length, 0);
    const candidate = target.store.findPropertyByAddress({ ...bayRoad, unit: null })!;
    await importProviderListings(new MockListingProvider(), target.store);

    // No new question is asked: the Bay Road unit goes to the property it was linked to.
    assert.equal(
      target.store
        .listPendingMatchReviews()
        .some((review) => review.candidatePropertyId === candidate.id),
      false,
    );
    assert.equal(target.store.listListings(candidate.id).length > 0, true);
    assert.equal(
      target.store.findPropertyByAddress({ ...bayRoad, unit: '1204' }),
      null,
      'Link does not create a separate unit property',
    );
  });

  it('keeps a restored Keep separate decision attached to its own property', async () => {
    const source = await freshStore();
    await seedPersonalData(source.store, 'keep_separate');
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store, exportedAt)));

    const target = await freshStore();
    importBackup(target.store, backup);
    await importProviderListings(new MockListingProvider(), target.store);

    const bayBuilding = target.store.findPropertyByAddress({ ...bayRoad, unit: null });
    assert.ok(
      !bayBuilding ||
        !target.store
          .listPendingMatchReviews()
          .some((review) => review.candidatePropertyId === bayBuilding.id),
    );
    const separate = target.store.listProperties().find((property) => property.unit !== null)!;
    assert.equal(separate.street.includes('Bay'), true);
    assert.equal(target.store.listListings(separate.id).length, 1);
    const [decision] = target.store.listDecidedMatchReviews();
    assert.throws(() => target.store.undoMatchReview(decision!.id), /restored from a backup/);
  });

  it('refuses a newer format version and changes nothing', async () => {
    const source = await freshStore();
    await seedPersonalData(source.store, 'link');
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store, exportedAt)));

    const target = await freshStore();
    const property = target.store.createProperty({ ...bayRoad });
    target.store.addNote(property.id, 'Mine');
    const before = exportBackup(target.store, exportedAt);

    assert.throws(
      () => importBackup(target.store, { ...backup, formatVersion: BACKUP_VERSION + 1 }),
      (error: unknown) =>
        error instanceof BackupError && /newer .* Nothing was changed/.test(error.message),
    );
    assert.deepEqual(exportBackup(target.store, exportedAt), before);
    assert.equal(target.store.listSavedSearches().length, 0);
  });

  it('upgrades an older format version through its migration steps', async () => {
    const target = await freshStore();
    const olderFile = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: exportedAt.toISOString(),
      properties: [],
      // Imagine format 1 called saved searches "searches".
      searches: [{ name: 'Old name', mode: 'sale', location: 'Miami 33131' }],
    };
    const report = importBackup(target.store, olderFile, {
      currentVersion: 2,
      steps: { 1: (data) => ({ ...data, savedSearches: data.searches }) },
    });
    assert.equal(report.migratedFromVersion, 1);
    assert.equal(report.added.savedSearches, 1);
    assert.equal(target.store.listSavedSearches()[0]!.name, 'Old name');

    assert.throws(
      () => importBackup(target.store, olderFile, { currentVersion: 3, steps: {} }),
      /no way to upgrade/,
    );
  });

  it('refuses files that are not a backup', async () => {
    const target = await freshStore();
    for (const notABackup of [
      'text',
      [],
      null,
      {},
      { format: 'something-else', formatVersion: 1 },
      { format: BACKUP_FORMAT },
      { format: BACKUP_FORMAT, formatVersion: 0 },
      { format: BACKUP_FORMAT, formatVersion: '1' },
      { format: BACKUP_FORMAT, formatVersion: 1, properties: 'nope' },
    ]) {
      assert.throws(() => importBackup(target.store, notABackup), BackupError);
    }
  });

  it('skips unreadable records, reports them, and imports the rest', async () => {
    const target = await freshStore();
    const report = importBackup(target.store, {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_VERSION,
      exportedAt: exportedAt.toISOString(),
      properties: [
        {
          key: { street: '12 palm ave', unit: null, city: 'miami', zip: '33131' },
          address: { street: '12 Palm Ave', unit: null, city: 'Miami', zip: '33131' },
          county: 'Miami-Dade',
          latitude: 25.76,
          longitude: -80.19,
          sample: false,
          saved: { at: '2026-10-01T10:00:00.000Z' },
          dismissed: null,
          notes: [
            { body: 'Good light', createdAt: '2026-10-01T10:00:00.000Z' },
            { body: '   ', createdAt: '2026-10-01T10:00:00.000Z' },
            { createdAt: 'not a date', body: 'Bad date' },
          ],
        },
        { address: { street: '', city: 'Miami', zip: '33131' }, key: {} },
        {
          key: { street: 'wrong', unit: null, city: 'miami', zip: '33131' },
          address: { street: '99 Other St', city: 'Miami', zip: '33131' },
        },
      ],
      savedSearches: [
        { name: 'Fine', mode: 'rent', location: 'Miami 33131' },
        { name: 'Bad range', mode: 'sale', location: 'Miami', priceMin: 9, priceMax: 1 },
        { name: 'Bad mode', mode: 'lease', location: 'Miami' },
      ],
      matchDecisions: [
        {
          provider: 'mock',
          sourceId: 'x',
          decision: 'link',
          decidedAt: '2026-10-02T00:00:00.000Z',
          candidate: { street: 'missing', unit: null, city: 'miami', zip: '33131' },
        },
      ],
    });

    assert.equal(report.added.properties, 1);
    assert.equal(report.added.notes, 1);
    assert.equal(report.added.saved, 1);
    assert.equal(report.added.savedSearches, 1);
    assert.deepEqual(
      report.skipped.map((entry) => entry.section).sort(),
      [
        'matchDecisions',
        'notes',
        'notes',
        'properties',
        'properties',
        'savedSearches',
        'savedSearches',
      ].sort(),
    );
    assert.equal(target.store.listProperties()[0]!.latitude, 25.76);
    assert.equal(target.store.listNotes(target.store.listProperties()[0]!.id).length, 1);
  });

  it('serves the export and import over HTTP and refuses a newer file without changes', async () => {
    const source = await freshStore();
    await seedPersonalData(source.store, 'link');
    const sourceServer = createApp(source.database, source.store);
    await new Promise<void>((resolve) => sourceServer.listen(0, '127.0.0.1', resolve));
    const target = await freshStore();
    const targetServer = createApp(target.database, target.store);
    await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
    const url = (server: typeof sourceServer, path: string) => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
      return `http://127.0.0.1:${address.port}${path}`;
    };

    try {
      const exported = await fetch(url(sourceServer, '/api/backup/export'));
      assert.equal(exported.status, 200);
      assert.match(
        exported.headers.get('content-disposition') ?? '',
        /^attachment; filename="ledgerline-backup-\d{4}-\d{2}-\d{2}\.json"$/,
      );
      const text = await exported.text();

      const imported = await fetch(url(targetServer, '/api/backup/import'), {
        method: 'POST',
        body: text,
      });
      assert.equal(imported.status, 200);
      const { report } = (await imported.json()) as { report: { added: { notes: number } } };
      assert.equal(report.added.notes, 3);

      const before = exportBackup(target.store, exportedAt);
      const newer = await fetch(url(targetServer, '/api/backup/import'), {
        method: 'POST',
        body: JSON.stringify({ ...JSON.parse(text), formatVersion: 99 }),
      });
      assert.equal(newer.status, 400);
      assert.match(((await newer.json()) as { error: string }).error, /newer/);
      const garbled = await fetch(url(targetServer, '/api/backup/import'), {
        method: 'POST',
        body: '{not json',
      });
      assert.equal(garbled.status, 400);
      assert.deepEqual(exportBackup(target.store, exportedAt), before);
    } finally {
      await new Promise((resolve) => sourceServer.close(resolve));
      await new Promise((resolve) => targetServer.close(resolve));
    }
  });
});
