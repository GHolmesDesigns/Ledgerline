// Reads the Milestone 0 record sheets (CSV) back in. They are filled in by hand, so every cell the scoring
// depends on is checked and a bad one is reported by sheet row, never by listing address.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSV_HEADER } from './picks.mjs';

export const PROVIDER_TO_PUBLIC = 'provider to public';
export const PUBLIC_TO_PROVIDER = 'public to provider';

// Plan, step 5: "Status agrees" compares groups, not words.
export const ACTIVE = 'Active';
export const UNDER_CONTRACT = 'Under contract';
export const OFF_MARKET = 'Off market';
const STATUS_GROUPS = new Map([
  ['active', ACTIVE],
  ['under contract', UNDER_CONTRACT], ['pending', UNDER_CONTRACT], ['contingent', UNDER_CONTRACT], ['accepting backup offers', UNDER_CONTRACT],
  ['off market', OFF_MARKET], ['sold', OFF_MARKET], ['rented', OFF_MARKET], ['withdrawn', OFF_MARKET], ['expired', OFF_MARKET],
]);

const MODES = new Map([['sale', 'sale'], ['buy', 'sale'], ['rental', 'rental'], ['rent', 'rental']]);
export const modeOf = (text) => MODES.get(String(text ?? '').trim().toLowerCase());
const CLASSIFICATIONS = {
  [PROVIDER_TO_PUBLIC]: ['available', 'not available', 'not found', 'ambiguous'],
  [PUBLIC_TO_PROVIDER]: ['found', 'not found'],
};

// RFC 4180 enough for what Excel and Sheets save: quoted commas and quotes, CRLF, a leading byte-order mark.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (body[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const lower = (v) => String(v ?? '').trim().toLowerCase();
const price = (v) => {
  const text = String(v ?? '').replace(/[$,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : null;
};

// One sheet row, as the scoring needs it. No address, unit, or provider id is carried forward.
// `line` is the spreadsheet row number (the header is row 1). Problems are pushed onto `problems`.
export function normalizeRow(record, line, problems) {
  const at = `row ${line}`;
  const direction = lower(record.direction);
  const mode = MODES.get(lower(record.mode));
  const county = String(record.county ?? '').trim();
  const bad = (what) => problems.push(`${at}: ${what}`);
  if (!CLASSIFICATIONS[direction]) bad(`direction "${record.direction}" is not "${PROVIDER_TO_PUBLIC}" or "${PUBLIC_TO_PROVIDER}"`);
  if (!mode) bad(`mode "${record.mode}" is not sale or rental`);
  if (!county) bad('county is empty');

  const raw = lower(record.classification);
  let classification = null;
  if (raw && CLASSIFICATIONS[direction]) {
    if (CLASSIFICATIONS[direction].includes(raw)) classification = raw;
    else bad(`classification "${record.classification}" is not one of: ${CLASSIFICATIONS[direction].join(', ')}`);
  }

  const row = { line, county, mode, direction, seed: String(record.seed ?? '').trim(), classification };
  if (direction === PUBLIC_TO_PROVIDER && classification === 'found') {
    // A found listing is compared with its public listing, so both sides need a status and a price.
    for (const side of ['public', 'provider']) {
      const group = STATUS_GROUPS.get(lower(record[`${side}_status`]));
      const amount = price(record[`${side}_price`]);
      if (!group) bad(`${side}_status "${record[`${side}_status`]}" is not one of the plan's words (Active, Under contract, Off market, or pending, contingent, sold, rented, withdrawn, expired)`);
      if (amount == null || amount <= 0) bad(`${side}_price is missing or not a number`);
      row[`${side}Group`] = group;
      row[`${side}Price`] = amount;
    }
  }
  return row;
}

// Provider ids already in a still-available sheet, so extra picks are new listings. Lenient on purpose: a sheet
// half-way through being filled in still has its ids. `skipFile` is the sheet about to be written, so rerunning
// the same seed gives the same picks.
export function checkedProviderIds(picksDir, skipFile = null) {
  const ids = new Set();
  if (!existsSync(picksDir)) return ids;
  for (const name of readdirSync(picksDir).filter((f) => f.toLowerCase().endsWith('.csv') && f !== skipFile)) {
    const [header = [], ...records] = parseCsv(readFileSync(join(picksDir, name), 'utf8'));
    const col = (c) => header.map(lower).indexOf(c);
    const [id, direction] = [col('provider_id'), col('direction')];
    if (id < 0 || direction < 0) continue;
    for (const cells of records) if (lower(cells[direction]) === PROVIDER_TO_PUBLIC && cells[id]?.trim()) ids.add(cells[id].trim());
  }
  return ids;
}

export class SheetError extends Error {
  constructor(problems) {
    super(`Fix these cells in the record sheet, then score again:\n  ${problems.join('\n  ')}`);
    this.problems = problems;
  }
}

// `files` are the sheets named with --sheet; otherwise every CSV in the picks folder, in name order.
export function loadSheets(picksDir, files = []) {
  const paths = files.length ? files : existsSync(picksDir) ? readdirSync(picksDir).filter((f) => f.toLowerCase().endsWith('.csv')).sort().map((f) => join(picksDir, f)) : [];
  const rows = [];
  const problems = [];
  for (const path of paths) {
    const [header = [], ...records] = parseCsv(readFileSync(path, 'utf8'));
    const missing = CSV_HEADER.filter((c) => !header.map(lower).includes(c));
    if (missing.length) { problems.push(`${path}: missing column ${missing.join(', ')}`); continue; }
    const index = new Map(header.map((c, i) => [lower(c), i]));
    records.forEach((cells, i) => {
      if (cells.every((c) => c.trim() === '')) return; // blank lines an editor adds at the end
      const record = Object.fromEntries(CSV_HEADER.map((c) => [c, cells[index.get(c)] ?? '']));
      const own = [];
      rows.push(normalizeRow(record, i + 2, own));
      problems.push(...own.map((p) => `${paths.length > 1 ? `${path.split(/[\\/]/).pop()} ` : ''}${p}`));
    });
  }
  if (problems.length) throw new SheetError(problems);
  return { rows, files: paths };
}
