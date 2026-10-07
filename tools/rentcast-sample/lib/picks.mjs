// Seeded random picks of "active" provider results for the still-available check (plan step 4).
// The same seed over the same saved data always returns the same listings.
import { isActive } from './runs.mjs';

export const PICKS_PER_CELL = 10;

// FNV-1a: any seed text becomes a 32-bit number.
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: small seeded generator, returns floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Partial Fisher-Yates shuffle. `items` must already be in a stable order.
export function pickRandom(items, count, seed) {
  const pool = [...items];
  const rand = mulberry32(hashSeed(seed));
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

// Unique active listings by provider id, in id order, so the picks don't depend on response order.
function pool(listings) {
  const byId = new Map();
  for (const l of listings.filter(isActive)) byId.set(l.id, l);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Each county-and-mode cell has its own stream, so one cell's picks never shift because of another.
export function pickCells(runs, seed, count = PICKS_PER_CELL) {
  return runs.flatMap((run) =>
    run.searches.map((search) => {
      const candidates = pool(search.listings);
      return {
        area: run.area,
        county: run.county,
        mode: search.mode,
        runId: run.runId,
        fetchedAt: search.fetchedAt,
        poolSize: candidates.length,
        picks: pickRandom(candidates, count, `${seed}|${run.area}|${search.mode}`),
      };
    }),
  );
}

const quote = (v) => {
  const text = v == null ? '' : String(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// The columns of the plan's record sheet; the last four are filled in by hand during the check.
export const CSV_HEADER = ['county', 'mode', 'direction', 'seed', 'address', 'unit', 'provider_id', 'mls_number', 'provider_status', 'provider_price', 'public_status', 'public_price', 'classification', 'time_checked'];

export function picksCsv(cells, seed) {
  const rows = cells.flatMap((cell) =>
    cell.picks.map((l) => [cell.county, cell.mode, 'provider to public', seed, l.formattedAddress, l.addressLine2, l.id, l.mlsNumber, l.status, l.price, '', '', '', '']),
  );
  return [CSV_HEADER, ...rows].map((row) => row.map(quote).join(',')).join('\n') + '\n';
}
