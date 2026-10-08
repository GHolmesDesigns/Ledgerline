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

describe('local API bootstrap', () => {
  it('creates an empty SQLite database and applies each numbered migration once', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-api-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'data', 'ledgerline.sqlite');
    const first = await openDatabase(path);
    assert.deepEqual(rows(first, 'SELECT version, name FROM schema_migrations'), [
      { version: 1, name: '001_bootstrap.sql' },
      { version: 2, name: '002_core_schema.sql' },
    ]);
    closeDatabase(first);

    const second = await openDatabase(path);
    assert.deepEqual(rows(second, 'SELECT COUNT(*) AS count FROM schema_migrations'), [
      { count: 2 },
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
