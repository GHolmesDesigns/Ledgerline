// Shared by the unit tests. Nothing here talks to RentCast: `fakeFetch` stands in for the network.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const invented = JSON.parse(readFileSync(join(here, 'invented-listings.json'), 'utf8'));
export const TEST_KEY = 'test-key-not-a-real-key';

export async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ledgerline-m0-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const testPaths = (dir) => ({ usage: join(dir, 'usage.json'), raw: join(dir, 'raw'), estimates: join(dir, 'estimates') });

// A config that passes parseConfig, with its own placeholder-free areas.
export function validRawConfig(overrides = {}) {
  const area = (county) => ({ county, sale: { zipCode: '00000', price: '1:2' }, rental: { zipCode: '00000' } });
  return { apiKey: TEST_KEY, areas: { alpha: area('Alpha'), beta: area('Beta') }, ...overrides };
}

const respond = (status, body) => ({ status, text: async () => JSON.stringify(body) });

// Serves `sale` and `rental` the way RentCast pages them (limit and offset), and records every call.
export function fakeFetch({ sale = invented.sale, rental = invented.rental, fail = null, noResponse = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: String(url), path: u.pathname, params: Object.fromEntries(u.searchParams), headers: init.headers });
    if (noResponse) throw new Error('network down');
    if (fail) return respond(fail.status, fail.body);
    if (u.pathname.endsWith('/avm/rent/long-term')) return respond(200, { rent: 2500, rentRangeLow: 2300, rentRangeHigh: 2700, comparables: [{}, {}, {}] });
    const rows = u.pathname.endsWith('/listings/sale') ? sale : rental;
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset') ?? 0);
    return respond(200, rows.slice(offset, offset + limit));
  };
  fn.calls = calls;
  return fn;
}

// A loaded run (see lib/runs.mjs) built in memory.
export function makeRun({ area = 'alpha', county = 'Alpha', sale = [], rental = [], fetchedAt = invented.pulledAt, complete = true } = {}) {
  const search = (mode, listings) => ({ mode, params: {}, fetchedAt, requests: 1, pages: [{ file: `${mode}-page1.json`, count: listings.length }], complete, stoppedReason: complete ? null : 'Stopped before sending: cap.', listings });
  return { runId: `20261007T120000Z-${area}`, area, county, startedAt: fetchedAt, searches: [search('sale', sale), search('rental', rental)] };
}
