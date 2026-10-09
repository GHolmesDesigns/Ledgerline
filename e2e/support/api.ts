import { expect, type Page } from '@playwright/test';
import initSqlJs from 'sql.js';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';

// Runs the real API as its own process on a temporary data folder (never the dev
// database), so a test can seed it, delete the data folder, and restart.
export const repoRoot = resolve(__dirname, '..', '..');
export const tsx = ['--import', 'tsx'];

const freePort = () =>
  new Promise<number>((resolvePort, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });

/** The sample listings and saved searches, including synthetic match-review cases. */
export function seedDatabase(databasePath: string) {
  execFileSync(process.execPath, [...tsx, 'apps/api/scripts/seed-e2e.ts'], {
    cwd: repoRoot,
    env: { ...process.env, LEDGERLINE_DATA_PATH: databasePath },
    stdio: 'ignore',
  });
}

export async function startApi(databasePath: string) {
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

export type Api = Awaited<ReturnType<typeof startApi>>;

/** Sends the page's /api requests to whichever API `getApi` returns when they happen. */
export async function routeApiTo(page: Page, getApi: () => Api) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: getApi().url(`${url.pathname}${url.search}`) });
    await route.fulfill({ response });
  });
}

// Reads the saved SQLite file, which the API rewrites after every change.
export async function readDatabase(databasePath: string) {
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
