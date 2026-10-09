import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDatabase, routeApiTo, seedDatabase, startApi, type Api } from './support/api';

const send = (api: Api, path: string, method: string, body?: unknown) =>
  fetch(api.url(path), { method, body: body === undefined ? undefined : JSON.stringify(body) });

test('export, delete the data folder, restart, and import restores personal data', async ({
  page,
}, testInfo) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-backup-'));
  const dataDirectory = join(root, 'data');
  const databasePath = join(dataDirectory, 'ledgerline.sqlite');
  let api: Api | undefined;
  try {
    // The sample listings and saved searches, as after `npm run import:mock`.
    seedDatabase(databasePath);
    api = await startApi(databasePath);

    const found = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
      items: Array<{ property: { id: string; street: string } }>;
    };
    const fortLauderdale = found.items.find((item) => item.property.street === '2207 NE 32nd Ct')!;
    const other = found.items.find((item) => item.property.id !== fortLauderdale.property.id)!;
    expect(fortLauderdale).toBeTruthy();
    for (const body of ['Quiet street; ask about the flood zone', 'Roof replaced in 2020']) {
      expect(
        (await send(api, `/api/properties/${fortLauderdale.property.id}/notes`, 'POST', { body }))
          .status,
      ).toBe(201);
    }
    await send(api, `/api/properties/${fortLauderdale.property.id}/favorite`, 'PUT', {
      saved: true,
    });
    await send(api, `/api/properties/${other.property.id}/dismissal`, 'PUT', { dismissed: true });
    await send(api, '/api/saved-searches', 'POST', {
      name: 'My Fort Lauderdale search',
      mode: 'sale',
      location: 'Fort Lauderdale 33308',
      priceMax: 900000,
      refreshIntervalDays: 7,
    });
    await send(api, '/api/local-assumptions/Broward', 'PUT', {
      millage: 18.75,
      typicalNonAdValoremPerYear: 700,
      homeownersDefaultMonthly: 520,
      ho6DefaultMonthly: 110,
      floodDefaultMonthly: { X: 50, AE: 180, VE: 420 },
      source: 'Broward tax collector',
      setOn: '2026-10-09',
    });
    const searches = (await (await fetch(api.url('/api/saved-searches'))).json()) as {
      items: Array<{ name: string }>;
    };
    const searchNames = searches.items.map((search) => search.name);
    expect(searchNames).toContain('My Fort Lauderdale search');

    // The page talks to whichever API is running now.
    await routeApiTo(page, () => api!);
    await page.goto('/settings');
    const ranking = page.getByRole('region', { name: 'Ranking weights' });
    await ranking.getByLabel('price weight').fill('37');
    await ranking.getByRole('button', { name: 'Save Buy weights' }).click();
    await expect(ranking.getByRole('status')).toHaveText('Saved');
    const backup = page.getByRole('region', { name: 'Backup and restore' });
    await expect(page.getByRole('heading', { name: 'Backup and restore' })).toBeVisible();
    await expect(backup.getByRole('button', { name: 'Import personal data' })).toBeDisabled();

    // Export.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      backup.getByRole('button', { name: 'Export personal data' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ledgerline-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const backupPath = testInfo.outputPath('backup.json');
    await download.saveAs(backupPath);
    await expect(backup.getByRole('status')).toContainText('Exported your personal data to');
    const backupText = readFileSync(backupPath, 'utf8');
    expect(JSON.parse(backupText).formatVersion).toBe(5);
    expect(JSON.parse(backupText).rankingWeights.sale.price).toBe(37);
    // Rent weights were never changed, so the file leaves them to the defaults.
    expect(JSON.parse(backupText).rankingWeights.rent).toBeNull();
    expect(backupText).not.toContain('prop_');
    expect(backupText).not.toContain('849000');

    // Delete the data folder and restart with nothing in it.
    await api.stop();
    rmSync(dataDirectory, { recursive: true, force: true });
    api = await startApi(databasePath);
    await page.reload();
    await expect(page.getByLabel('My Fort Lauderdale search name')).toHaveCount(0);
    await expect(ranking.getByLabel('price weight')).toHaveValue('25');

    // Import.
    await backup.getByLabel('Backup file (.json)').setInputFiles(backupPath);
    await backup.getByRole('button', { name: 'Import personal data' }).click();
    await expect(backup.getByRole('status')).toContainText(
      `Imported 3 cost records, 2 notes, 1 saved home, 1 dismissed home, ${searchNames.length} saved searches, 8 properties, ${searchNames.length} personal assumption sets, 1 local rate set, 1 ranking weight set. Already here: 2 local rate sets.`,
    );
    await page.reload();
    await expect(page.getByLabel('My Fort Lauderdale search name')).toBeVisible();
    await expect(ranking.getByLabel('price weight')).toHaveValue('37');

    let database = await readDatabase(databasePath);
    expect(
      database.rows(`SELECT n.body FROM property_notes n JOIN properties p ON p.id = n.property_id
        WHERE p.street = '2207 NE 32nd Ct' ORDER BY n.id`),
    ).toEqual([
      { body: 'Quiet street; ask about the flood zone' },
      { body: 'Roof replaced in 2020' },
    ]);
    expect(database.rows('SELECT COUNT(*) AS n FROM property_favorites')).toEqual([{ n: 1 }]);
    expect(database.rows('SELECT COUNT(*) AS n FROM property_dismissals')).toEqual([{ n: 1 }]);
    expect(
      database.rows('SELECT name FROM saved_searches ORDER BY id').map((row) => row.name),
    ).toEqual(searchNames);
    // Listings are not part of a backup; they come back with the next refresh.
    expect(database.rows('SELECT COUNT(*) AS n FROM listings')).toEqual([{ n: 0 }]);
    expect(
      database
        .rows('SELECT mode, weights FROM ranking_weights')
        .map((row) => ({ mode: row.mode, price: JSON.parse(String(row.weights)).price })),
    ).toEqual([{ mode: 'sale', price: 37 }]);
    database.close();

    // Importing the same file again adds nothing.
    await backup.getByLabel('Backup file (.json)').setInputFiles(backupPath);
    await backup.getByRole('button', { name: 'Import personal data' }).click();
    await expect(backup.getByRole('status')).toContainText('Nothing new to import.');
    await expect(backup.getByRole('status')).toContainText('Already here: 3 cost records, 2 notes');

    // A file from a newer version is refused and nothing changes.
    const newerPath = testInfo.outputPath('newer-backup.json');
    writeFileSync(newerPath, JSON.stringify({ ...JSON.parse(backupText), formatVersion: 99 }));
    await backup.getByLabel('Backup file (.json)').setInputFiles(newerPath);
    await backup.getByRole('button', { name: 'Import personal data' }).click();
    await expect(backup.getByRole('alert')).toContainText('newer');

    database = await readDatabase(databasePath);
    expect(database.rows('SELECT COUNT(*) AS n FROM properties')).toEqual([{ n: 8 }]);
    expect(database.rows('SELECT COUNT(*) AS n FROM property_notes')).toEqual([{ n: 2 }]);
    expect(database.rows('SELECT COUNT(*) AS n FROM saved_searches')).toEqual([
      { n: searchNames.length },
    ]);
    expect(
      database.rows(
        "SELECT millage, source, set_on, sample FROM local_assumptions WHERE county = 'Broward'",
      ),
    ).toEqual([
      { millage: 18.75, source: 'Broward tax collector', set_on: '2026-10-09', sample: 0 },
    ]);
    database.close();
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
