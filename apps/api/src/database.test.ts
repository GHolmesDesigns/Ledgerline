import initSqlJs, { type Database } from 'sql.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase } from './database.js';
import { createApp } from './app.js';

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
    ]);
    closeDatabase(first);

    const second = await openDatabase(path);
    assert.deepEqual(rows(second, 'SELECT COUNT(*) AS count FROM schema_migrations'), [
      { count: 3 },
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
