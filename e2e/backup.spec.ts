import { expect, test } from '@playwright/test';
import initSqlJs from 'sql.js';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the real API as its own process on a temporary data folder (never the dev
// database), so the test can delete the data folder and restart, as acceptance check
// 1.6 describes.
const repoRoot = resolve(__dirname, '..');
const tsx = ['--import', 'tsx'];

const freePort = () =>
  new Promise<number>((resolvePort, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });

async function startApi(databasePath: string) {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [...tsx, 'apps/api/src/server.ts'], {
    cwd: repoRoot,
    env: { ...process.env, API_PORT: String(port), LEDGERLINE_DATA_PATH: databasePath },
    stdio: 'ignore',
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return {
    port,
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((done) => child.once('exit', done));
      child.kill();
      await exited;
    },
  };
}

type Api = Awaited<ReturnType<typeof startApi>>;

// Reads the saved SQLite file, which the API rewrites after every change.
async function readDatabase(databasePath: string) {
  const SQL = await initSqlJs();
  const database = new SQL.Database(new Uint8Array(readFileSync(databasePath)));
  const rows = (sql: string) => {
    const statement = database.prepare(sql);
    const result: Record<string, unknown>[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    statement.free();
    return result;
  };
  return { rows, close: () => database.close() };
}

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
    // A database with sample listings and sample saved searches, as after `npm run import:mock`.
    execFileSync(process.execPath, [...tsx, 'apps/api/src/providers/import-cli.ts'], {
      cwd: repoRoot,
      env: { ...process.env, LEDGERLINE_DATA_PATH: databasePath },
      stdio: 'ignore',
    });
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
    const searches = (await (await fetch(api.url('/api/saved-searches'))).json()) as {
      items: Array<{ name: string }>;
    };
    const searchNames = searches.items.map((search) => search.name);
    expect(searchNames).toContain('My Fort Lauderdale search');

    // The page talks to whichever API is running now.
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: api!.url(`${url.pathname}${url.search}`) });
      await route.fulfill({ response });
    });
    await page.goto('/settings');
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
    expect(JSON.parse(backupText).formatVersion).toBe(1);
    expect(backupText).not.toContain('prop_');
    expect(backupText).not.toContain('849000');

    // Delete the data folder and restart with nothing in it.
    await api.stop();
    rmSync(dataDirectory, { recursive: true, force: true });
    api = await startApi(databasePath);
    await page.reload();
    await expect(page.getByLabel('My Fort Lauderdale search name')).toHaveCount(0);

    // Import.
    await backup.getByLabel('Backup file (.json)').setInputFiles(backupPath);
    await backup.getByRole('button', { name: 'Import personal data' }).click();
    await expect(backup.getByRole('status')).toContainText(
      `Imported 2 notes, 1 saved home, 1 dismissed home, ${searchNames.length} saved searches, 2 properties.`,
    );
    await page.reload();
    await expect(page.getByLabel('My Fort Lauderdale search name')).toBeVisible();

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
    database.close();

    // Importing the same file again adds nothing.
    await backup.getByLabel('Backup file (.json)').setInputFiles(backupPath);
    await backup.getByRole('button', { name: 'Import personal data' }).click();
    await expect(backup.getByRole('status')).toContainText('Nothing new to import.');
    await expect(backup.getByRole('status')).toContainText('Already here: 2 notes');

    // A file from a newer version is refused and nothing changes.
    const newerPath = testInfo.outputPath('newer-backup.json');
    writeFileSync(newerPath, JSON.stringify({ ...JSON.parse(backupText), formatVersion: 99 }));
    await backup.getByLabel('Backup file (.json)').setInputFiles(newerPath);
    await backup.getByRole('button', { name: 'Import personal data' }).click();
    await expect(backup.getByRole('alert')).toContainText('newer');

    database = await readDatabase(databasePath);
    expect(database.rows('SELECT COUNT(*) AS n FROM properties')).toEqual([{ n: 2 }]);
    expect(database.rows('SELECT COUNT(*) AS n FROM property_notes')).toEqual([{ n: 2 }]);
    expect(database.rows('SELECT COUNT(*) AS n FROM saved_searches')).toEqual([
      { n: searchNames.length },
    ]);
    database.close();
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
