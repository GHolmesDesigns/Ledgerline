import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createApp } from './app.js';
import { closeDatabase, openDatabase } from './database.js';
import { createStore } from './store.js';
import { MAX_PROPERTY_PHOTO_BYTES } from './property-photos.js';

const folders: string[] = [];
const databases: Awaited<ReturnType<typeof openDatabase>>[] = [];
const oldPhotoPath = process.env.LEDGERLINE_PHOTOS_PATH;

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  if (oldPhotoPath === undefined) delete process.env.LEDGERLINE_PHOTOS_PATH;
  else process.env.LEDGERLINE_PHOTOS_PATH = oldPhotoPath;
});

async function setup() {
  const folder = mkdtempSync(join(tmpdir(), 'ledgerline-photos-'));
  folders.push(folder);
  const photoPath = join(folder, 'photos');
  process.env.LEDGERLINE_PHOTOS_PATH = photoPath;
  const database = await openDatabase(join(folder, 'ledgerline.sqlite'));
  databases.push(database);
  const store = createStore(database);
  const property = store.createProperty({ street: '123 Sample St', city: 'Miami', zip: '33131' });
  const server = createApp(database, store);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  return {
    store,
    property,
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

describe('property photos', () => {
  it('accepts valid local images, serves them, and rejects unsupported or oversized uploads', async () => {
    const app = await setup();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    try {
      const rejected = await fetch(`${app.url}/api/properties/${app.property.id}/photos`, {
        method: 'POST',
        headers: { 'content-type': 'image/gif' },
        body: png,
      });
      assert.equal(rejected.status, 400);
      assert.match(((await rejected.json()) as { error: string }).error, /JPEG, PNG, or WebP/);

      const oversized = await fetch(`${app.url}/api/properties/${app.property.id}/photos`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: Buffer.concat([png, Buffer.alloc(MAX_PROPERTY_PHOTO_BYTES)]),
      });
      assert.equal(oversized.status, 400);
      assert.match(((await oversized.json()) as { error: string }).error, /10 MB/);

      const uploaded = await fetch(`${app.url}/api/properties/${app.property.id}/photos`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: png,
      });
      assert.equal(uploaded.status, 201);
      const { photo } = (await uploaded.json()) as {
        photo: { id: string; url: string; missing: boolean };
      };
      assert.equal(photo.missing, false);
      const served = await fetch(`${app.url}${photo.url}`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
    } finally {
      await new Promise<void>((resolve) => app.server.close(() => resolve()));
    }
  });

  it('backs up photo metadata without image bytes and imports a missing file as missing', async () => {
    const source = await setup();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    let target: Awaited<ReturnType<typeof setup>> | null = null;
    try {
      await fetch(`${source.url}/api/properties/${source.property.id}/photos`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: png,
      });
      const exported = await fetch(`${source.url}/api/backup/export`);
      const backupText = await exported.text();
      assert.ok(backupText.includes('photos'));
      assert.ok(!backupText.includes(png.toString('base64')));

      const data = JSON.parse(backupText) as {
        properties: Array<{ address: { street: string }; photos: Array<{ path: string }> }>;
      };
      const photoFile = join(
        process.env.LEDGERLINE_PHOTOS_PATH!,
        data.properties[0]!.photos[0]!.path,
      );
      rmSync(photoFile);

      target = await setup();
      const imported = await fetch(`${target.url}/api/backup/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: backupText,
      });
      assert.equal(imported.status, 200);
      const restoredProperty = target.store.findPropertyByAddress({
        street: '123 Sample St',
        city: 'Miami',
        zip: '33131',
      })!;
      const detail = await fetch(`${target.url}/api/properties/${restoredProperty.id}`);
      const result = (await detail.json()) as { photos: Array<{ missing: boolean }> };
      assert.equal(result.photos.length, 1);
      assert.equal(result.photos[0]!.missing, true);
    } finally {
      await new Promise<void>((resolve) => source.server.close(() => resolve()));
      if (target) await new Promise<void>((resolve) => target!.server.close(() => resolve()));
    }
  });
});
