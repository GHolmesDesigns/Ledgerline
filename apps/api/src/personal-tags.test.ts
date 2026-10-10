import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createApp } from './app.js';
import { closeDatabase, openDatabase, persistDatabase } from './database.js';
import { createStore, standardPersonalTags } from './store.js';

const directories: string[] = [];
const databases: Awaited<ReturnType<typeof openDatabase>>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-tags-'));
  directories.push(directory);
  const database = await openDatabase(join(directory, 'ledgerline.sqlite'));
  databases.push(database);
  const store = createStore(database, { afterWrite: () => persistDatabase(database) });
  const property = store.createProperty({ street: '123 Sample St', city: 'Miami', zip: '33131' });
  const server = createApp(database, store);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  return { store, property, server, url: `http://127.0.0.1:${address.port}` };
}

describe('personal tags API', () => {
  it('lists standard and shared custom tags and attaches them to a property', async () => {
    const app = await setup();
    try {
      const initial = await fetch(`${app.url}/api/personal-tags`);
      assert.deepEqual(await initial.json(), {
        standardTags: standardPersonalTags,
        customTags: [],
      });

      const created = await fetch(`${app.url}/api/personal-tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '  Rooftop deck  ' }),
      });
      assert.equal(created.status, 201);
      const secondProperty = app.store.createProperty({
        street: '2 Ocean Dr',
        city: 'Miami',
        zip: '33131',
      });
      for (const property of [app.property, secondProperty]) {
        const tagged = await fetch(`${app.url}/api/properties/${property.id}/tags`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Rooftop deck', enabled: true }),
        });
        assert.deepEqual(((await tagged.json()) as { tags: string[] }).tags, ['Rooftop deck']);
      }
      const standard = await fetch(`${app.url}/api/properties/${app.property.id}/tags`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Pool', enabled: true }),
      });
      assert.deepEqual(((await standard.json()) as { tags: string[] }).tags, [
        'Pool',
        'Rooftop deck',
      ]);
      const detail = await fetch(`${app.url}/api/properties/${app.property.id}`);
      assert.deepEqual(((await detail.json()) as { tags: string[] }).tags, [
        'Pool',
        'Rooftop deck',
      ]);

      const removed = await fetch(`${app.url}/api/properties/${app.property.id}/tags`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Pool', enabled: false }),
      });
      assert.deepEqual(((await removed.json()) as { tags: string[] }).tags, ['Rooftop deck']);
      assert.deepEqual(
        app.store.listPropertyTags(secondProperty.id).map((tag) => tag.name),
        ['Rooftop deck'],
      );
    } finally {
      await new Promise<void>((resolve) => app.server.close(() => resolve()));
    }
  });

  it('refuses empty, duplicate, standard-name, or overlength custom tags', async () => {
    const app = await setup();
    try {
      for (const [name, message] of [
        ['', /Enter a tag name/],
        ['Pool', /already exists/],
        ['pool', /already exists/],
        ['a'.repeat(31), /30 characters/],
      ] as const) {
        const response = await fetch(`${app.url}/api/personal-tags`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        assert.equal(response.status, 400);
        assert.match(((await response.json()) as { error: string }).error, message);
      }
      await app.store.createCustomTag('Roof deck');
      const duplicate = await fetch(`${app.url}/api/personal-tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ROOF DECK' }),
      });
      assert.match(((await duplicate.json()) as { error: string }).error, /already exists/);
    } finally {
      await new Promise<void>((resolve) => app.server.close(() => resolve()));
    }
  });
});
