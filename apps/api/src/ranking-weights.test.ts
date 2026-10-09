import type { Database } from 'sql.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createApp } from './app.js';
import { exportBackup, importBackup } from './backup.js';
import { closeDatabase, openDatabase, persistDatabase } from './database.js';
import { importProviderListings } from './providers/import-listings.js';
import { MockListingProvider } from './providers/mock-provider.js';
import { defaultRankingWeights, readRankingWeights } from './ranking-weights.js';
import { createStore } from './store.js';

const directories: string[] = [];
const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function freshStore() {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-weights-'));
  directories.push(directory);
  const database = await openDatabase(join(directory, 'ledgerline.sqlite'));
  databases.push(database);
  const store = createStore(database, {
    clock: () => new Date('2026-10-09T12:00:00.000Z'),
    afterWrite: () => persistDatabase(database),
  });
  return { database, store };
}

const buyWeights = { price: 40, cost: 20, flood: 20, hoa: 10, ins: 5, size: 5 };

describe('ranking weights', () => {
  it('uses the plan defaults until a mode is saved, and saves each mode separately', async () => {
    const { store } = await freshStore();
    assert.deepEqual(store.getRankingWeights('sale'), {
      mode: 'sale',
      weights: defaultRankingWeights.sale,
      updatedAt: null,
    });
    store.setRankingWeights('sale', buyWeights);
    assert.deepEqual(store.getRankingWeights('sale').weights, buyWeights);
    assert.equal(store.getRankingWeights('sale').updatedAt, '2026-10-09T12:00:00.000Z');
    assert.deepEqual(store.getRankingWeights('rent').weights, defaultRankingWeights.rent);
  });

  it("accepts only whole numbers from 0 to 100 for the mode's factors", () => {
    assert.deepEqual(readRankingWeights('rent', { price: 0, flood: 100, lease: 20, size: 15 }), {
      price: 0,
      flood: 100,
      lease: 20,
      size: 15,
    });
    assert.equal(readRankingWeights('sale', { ...buyWeights, price: 101 }), null);
    assert.equal(readRankingWeights('sale', { ...buyWeights, price: 2.5 }), null);
    assert.equal(readRankingWeights('sale', { ...buyWeights, hoa: undefined }), null);
    assert.equal(readRankingWeights('rent', buyWeights), null);
  });

  it('serves and saves weights through the local API', async () => {
    const { database, store } = await freshStore();
    const server = createApp(database, store);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const url = `http://127.0.0.1:${address.port}/api/ranking-weights`;
    const put = (body: unknown) =>
      fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      const initial = (await (await fetch(url)).json()) as {
        weights: { sale: { weights: unknown; updatedAt: string | null } };
      };
      assert.deepEqual(initial.weights.sale.weights, defaultRankingWeights.sale);
      assert.equal(initial.weights.sale.updatedAt, null);

      const saved = await put({ mode: 'sale', weights: buyWeights });
      assert.equal(saved.status, 200);
      assert.deepEqual(store.getRankingWeights('sale').weights, buyWeights);

      const invalid = await put({ mode: 'sale', weights: { ...buyWeights, size: -1 } });
      assert.equal(invalid.status, 400);
      assert.match(((await invalid.json()) as { error: string }).error, /0 to 100/);
      assert.equal((await put({ mode: 'other', weights: buyWeights })).status, 400);
      assert.deepEqual(store.getRankingWeights('sale').weights, buyWeights);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('round-trips saved weights through a backup and keeps weights the database already saved', async () => {
    const source = await freshStore();
    assert.deepEqual(exportBackup(source.store).rankingWeights, { sale: null, rent: null });
    source.store.setRankingWeights('sale', buyWeights);
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store)));
    assert.deepEqual(backup.rankingWeights, { sale: buyWeights, rent: null });

    const empty = await freshStore();
    const restored = importBackup(empty.store, backup);
    assert.equal(restored.added.rankingWeights, 1);
    assert.deepEqual(empty.store.getRankingWeights('sale').weights, buyWeights);
    assert.equal(empty.store.getRankingWeights('rent').updatedAt, null);

    const customized = await freshStore();
    const local = { ...buyWeights, price: 10, size: 35 };
    customized.store.setRankingWeights('sale', local);
    const kept = importBackup(customized.store, backup);
    assert.equal(kept.alreadyPresent.rankingWeights, 1);
    assert.deepEqual(customized.store.getRankingWeights('sale').weights, local);

    const unreadable = await freshStore();
    const report = importBackup(unreadable.store, {
      ...backup,
      rankingWeights: { sale: { ...buyWeights, price: 'high' }, rent: null },
    });
    assert.deepEqual(report.skipped, [
      {
        section: 'rankingWeights',
        label: 'Buy ranking weights',
        reason: 'The weights are unreadable.',
      },
    ]);
    assert.equal(unreadable.store.getRankingWeights('sale').updatedAt, null);
  });

  it('marks implausible values on search results before property detail is opened', async () => {
    const { database, store } = await freshStore();
    const server = createApp(database, store);
    await importProviderListings(new MockListingProvider(), store);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const root = `http://127.0.0.1:${address.port}`;
    type Item = {
      property: { id: string; street: string };
      listing: { id: string; implausibleFlags: Array<{ field: string; resolved: boolean }> };
    };
    const findMiami = async () =>
      (
        (await (await fetch(`${root}/api/listings?mode=sale`)).json()) as { items: Item[] }
      ).items.find((item) => item.property.street === '3250 NE 2nd Ave')!;
    try {
      const flagged = await findMiami();
      assert.deepEqual(
        flagged.listing.implausibleFlags.map(({ field, resolved }) => ({ field, resolved })),
        [{ field: 'livingAreaSqft', resolved: false }],
      );
      // Search does not store flags; property detail does, and Confirm resolves them there.
      assert.deepEqual(store.getListing(flagged.listing.id)!.implausibleFlags, []);
      await fetch(`${root}/api/properties/${flagged.property.id}`);
      const confirmed = await fetch(`${root}/api/listings/${flagged.listing.id}/implausible`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: 'livingAreaSqft', action: 'confirm' }),
      });
      assert.equal(confirmed.status, 200);
      assert.equal((await findMiami()).listing.implausibleFlags[0]!.resolved, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('upgrades a format 4 backup, which had no ranking weights', async () => {
    const source = await freshStore();
    const backup = JSON.parse(JSON.stringify(exportBackup(source.store)));
    delete backup.rankingWeights;
    const target = await freshStore();
    const report = importBackup(target.store, { ...backup, formatVersion: 4 });
    assert.equal(report.migratedFromVersion, 4);
    assert.equal(report.added.rankingWeights, 0);
    assert.deepEqual(report.skipped, []);
  });
});
