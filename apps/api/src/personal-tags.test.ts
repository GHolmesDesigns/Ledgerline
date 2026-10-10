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
        standardTagCounts: standardPersonalTags.map((name) => ({ name, propertyCount: 0 })),
        customTagCounts: [],
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

  it('filters by every selected tag locally, renames without collisions, and deletes only the tag', async () => {
    const app = await setup();
    try {
      const second = app.store.createProperty({
        street: '2 Ocean Dr',
        city: 'Miami',
        zip: '33131',
      });
      const third = app.store.createProperty({ street: '3 Ocean Dr', city: 'Miami', zip: '33131' });
      const custom = app.store.createCustomTag('Rooftop deck');
      for (const property of [app.property, second]) {
        app.store.setPropertyTag(property.id, 'Pool', true);
        app.store.setPropertyTag(property.id, custom.name, true);
      }
      app.store.setPropertyTag(third.id, 'Pool', true);
      app.store.addNote(app.property.id, 'Keep this note');
      app.store.upsertListing(app.property.id, {
        provider: 'mock',
        providerId: 'one',
        mode: 'sale',
        price: 400000,
        pricePeriod: 'total',
        status: 'active',
      });
      app.store.upsertListing(second.id, {
        provider: 'mock',
        providerId: 'two',
        mode: 'sale',
        price: 450000,
        pricePeriod: 'total',
        status: 'active',
      });
      const beforeRequests = app.store.listProviderRequestLogs().length;
      const search = await fetch(`${app.url}/api/listings?mode=sale&tag=Pool&tag=Rooftop%20deck`);
      assert.equal(search.status, 200);
      const result = (await search.json()) as { items: Array<{ property: { id: string } }> };
      assert.deepEqual(
        result.items.map((item) => item.property.id).sort(),
        [app.property.id, second.id].sort(),
      );
      assert.equal(app.store.listProviderRequestLogs().length, beforeRequests);

      const renamed = await fetch(`${app.url}/api/personal-tags/${custom.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Roof garden' }),
      });
      assert.equal(renamed.status, 200);
      assert.equal(((await renamed.json()) as { tag: { name: string } }).tag.name, 'Roof garden');
      assert.deepEqual(
        app.store.listPropertyTags(second.id).map((tag) => tag.name),
        ['Pool', 'Roof garden'],
      );

      const collision = await fetch(`${app.url}/api/personal-tags/${custom.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'pool' }),
      });
      assert.equal(collision.status, 400);
      assert.match(((await collision.json()) as { error: string }).error, /already exists/);

      const removed = await fetch(`${app.url}/api/personal-tags/${custom.id}`, {
        method: 'DELETE',
      });
      assert.deepEqual(await removed.json(), { deleted: { id: custom.id, propertyCount: 2 } });
      assert.deepEqual(
        app.store.listPropertyTags(app.property.id).map((tag) => tag.name),
        ['Pool'],
      );
      assert.equal(app.store.getProperty(app.property.id)?.id, app.property.id);
      assert.deepEqual(
        app.store.listNotes(app.property.id).map((note) => note.body),
        ['Keep this note'],
      );
      assert.equal(app.store.listListings(app.property.id).length, 1);
      assert.deepEqual(app.store.listCustomTags(), []);
    } finally {
      await new Promise<void>((resolve) => app.server.close(() => resolve()));
    }
  });
});
