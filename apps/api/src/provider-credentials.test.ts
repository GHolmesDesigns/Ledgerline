import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import initSqlJs from 'sql.js';
import { createApp } from './app.js';
import { closeDatabase, openDatabase } from './database.js';
import { ProviderCredentials } from './provider-credentials.js';
import { RefreshJob } from './providers/refresh-job.js';
import { RequestBudget } from './providers/request-budget.js';
import { createStore } from './store.js';
import type { ListingProvider } from './providers/listing-provider.js';

const directories: string[] = [];
const databases: Awaited<ReturnType<typeof openDatabase>>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

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

describe('local provider credentials', () => {
  it('stores the key locally and returns only whether it is set', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-credentials-'));
    directories.push(directory);
    const credentialFile = join(directory, '.env');
    const credentials = new ProviderCredentials(credentialFile);
    assert.equal(credentials.isRentCastConfigured(), false);

    const SQL = await initSqlJs();
    const database = new SQL.Database();
    const store = createStore(database);
    const api = await serve(database, store, undefined, credentials);
    const secret = 'fake-rentcast-api-key-123';
    try {
      const saved = await fetch(`${api.url}/api/provider-credentials`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rentCastApiKey: secret }),
      });
      const savedBody = await saved.text();
      assert.equal(saved.status, 200, savedBody);
      assert.deepEqual(JSON.parse(savedBody), { configured: true });
      assert.equal(savedBody.includes(secret), false);
      assert.match(readFileSync(credentialFile, 'utf8'), /RENTCAST_API_KEY=/);
      assert.equal(credentials.getRentCastKey(), secret);

      const status = await fetch(`${api.url}/api/provider-credentials`);
      const statusBody = await status.text();
      assert.deepEqual(JSON.parse(statusBody), { configured: true, googleMapsConfigured: false });
      assert.equal(statusBody.includes(secret), false);

      const invalid = await fetch(`${api.url}/api/provider-credentials`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rentCastApiKey: `${secret}\nLEAK=true` }),
      });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.text()).includes(secret), false);
    } finally {
      await api.close();
      database.close();
    }
  });

  it('stores the Google Maps key locally and reveals it only through the runtime map route', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-maps-key-'));
    directories.push(directory);
    const file = join(directory, '.env');
    const credentials = new ProviderCredentials(file);
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    const store = createStore(database);
    const api = await serve(database, store, undefined, credentials);
    const secret = 'fake-google-maps-key-123';
    try {
      const saved = await fetch(`${api.url}/api/google-maps-key`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ googleMapsApiKey: secret }),
      });
      assert.deepEqual(await saved.json(), { configured: true });
      assert.equal(credentials.getGoogleMapsKey(), secret);
      assert.match(readFileSync(file, 'utf8'), /GOOGLE_MAPS_API_KEY=/);

      const status = await fetch(`${api.url}/api/provider-credentials`);
      const statusText = await status.text();
      assert.deepEqual(JSON.parse(statusText), { configured: false, googleMapsConfigured: true });
      assert.equal(statusText.includes(secret), false);

      const runtime = await fetch(`${api.url}/api/google-maps-key`);
      assert.equal(runtime.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await runtime.json(), { key: secret });

      const invalid = await fetch(`${api.url}/api/google-maps-key`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ googleMapsApiKey: `${secret}\nLEAK=true` }),
      });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.text()).includes(secret), false);
    } finally {
      await api.close();
      database.close();
    }
  });

  it('keeps the mock usable and blocks a RentCast refresh before sending without a key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-credentials-'));
    directories.push(directory);
    const credentials = new ProviderCredentials(join(directory, '.env'));
    const database = await openDatabase(join(directory, 'db.sqlite'));
    databases.push(database);
    const store = createStore(database);
    const search = store.createSavedSearch({ name: 'Miami Buy', mode: 'sale', location: 'Miami' });
    const provider: ListingProvider = {
      name: 'RentCast',
      capabilities: {
        photos: false,
        sourceUrl: false,
        waterfront: false,
        bathSplit: false,
        history: false,
        hoaFee: false,
        rentEstimates: false,
      },
      async search() {
        throw new Error('A request should not be sent without a key.');
      },
      async getListing() {
        return null;
      },
    };
    const job = new RefreshJob(store, provider, new RequestBudget(store), () =>
      credentials.getRentCastKey(),
    );
    const api = await serve(database, store, job, credentials);
    try {
      const response = await fetch(`${api.url}/api/saved-searches/${search.id}/refresh`, {
        method: 'POST',
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        result: { searchId: search.id, error: 'No RentCast key set' },
      });
      assert.equal(store.listProviderRequestLogs().length, 0);
    } finally {
      await api.close();
    }
  });

  it('redacts the configured key from provider failures stored in request logs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-credentials-'));
    directories.push(directory);
    const credentials = new ProviderCredentials(join(directory, '.env'));
    const secret = 'fake-rentcast-api-key-456';
    credentials.setRentCastKey(secret);
    const database = await openDatabase(join(directory, 'db.sqlite'));
    databases.push(database);
    const store = createStore(database);
    const search = store.createSavedSearch({ name: 'Miami Buy', mode: 'sale', location: 'Miami' });
    const provider: ListingProvider = {
      name: 'RentCast',
      capabilities: {
        photos: false,
        sourceUrl: false,
        waterfront: false,
        bathSplit: false,
        history: false,
        hoaFee: false,
        rentEstimates: false,
      },
      async search() {
        throw new Error(`Provider echoed authorization ${secret}`);
      },
      async getListing() {
        return null;
      },
    };
    const result = await new RefreshJob(store, provider, new RequestBudget(store), () =>
      credentials.getRentCastKey(),
    ).refresh(search.id);
    assert.equal(result.error?.includes(secret), false);
    assert.match(result.error ?? '', /\[REDACTED\]/);
    assert.equal(store.listProviderRequestLogs()[0]?.errorMessage?.includes(secret), false);
  });
});
