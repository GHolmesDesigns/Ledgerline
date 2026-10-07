// Reads saved pulls back from disk. A loaded run is its manifest with each search's listings attached.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const isActive = (listing) => String(listing.status).toLowerCase() === 'active';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// Run folders start with a UTC timestamp, so name order is time order.
function runIds(rawDir) {
  if (!existsSync(rawDir)) return [];
  return readdirSync(rawDir).filter((id) => existsSync(join(rawDir, id, 'manifest.json'))).sort();
}

export function loadRun(rawDir, runId) {
  const dir = join(rawDir, runId);
  if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`No saved run named ${runId} in ${rawDir}`);
  const run = readJson(join(dir, 'manifest.json'));
  for (const search of run.searches) search.listings = search.pages.flatMap((p) => readJson(join(dir, p.file)));
  return run;
}

// The runs named with --run, or else the most recent run of each area.
export function loadRuns(rawDir, only = []) {
  if (only.length) return only.map((id) => loadRun(rawDir, id));
  const latest = new Map();
  for (const id of runIds(rawDir)) latest.set(readJson(join(rawDir, id, 'manifest.json')).area, id);
  if (!latest.size) throw new Error(`No saved pulls in ${rawDir}. Run "pull <area>" first.`);
  return [...latest.values()].sort().map((id) => loadRun(rawDir, id));
}

// Every saved sale listing from the latest run of each area, for looking one up by id.
export function findSaleListing(rawDir, id) {
  for (const run of loadRuns(rawDir)) {
    const sale = run.searches.find((s) => s.mode === 'sale');
    const hit = sale?.listings.find((l) => l.id === id);
    if (hit) return hit;
  }
  return null;
}
