// Scores the Milestone 0 measures with the plan's rules (Provider evaluation, step 5) and lists the rows of the
// decision table that apply. Pure: it reads normalized sheet rows (sheet.mjs) and coverage cells (report.mjs),
// and never sees an address, unit, or provider id.
import { PICKS_PER_CELL } from './picks.mjs';
import { PROVIDER_TO_PUBLIC, PUBLIC_TO_PROVIDER } from './sheet.mjs';

// Percentages are whole numbers, so the arithmetic below stays exact: 70% of 10 is 7, never 7.000000000000001.
export const THRESHOLDS = {
  coverage: { pooled: 80, floor: 70 }, //         16 of 20; 7 of 10
  stillAvailable: { pooled: 85, floor: 80 }, //   17 of 20; 8 of 10
  statusAgrees: { pooled: 90 },
  priceAgrees: { pooled: 90 },
  freshness: { cell: 90 },
  verification: { cell: 75 },
};
export const MODES = ['sale', 'rental'];
export const MODE_LABEL = { sale: 'Buy', rental: 'Rent' };

// Plan: "Required counts round up: required = ceiling(threshold x number checked)."
export const required = (pct, n) => Math.ceil((pct * n) / 100);

// Plan: price agrees when the provider's price is within 1% of the public price (so exactly 1% agrees).
export const withinOnePercent = (providerPrice, publicPrice) => Math.abs(providerPrice - publicPrice) * 100 <= publicPrice;

// The rows of one direction and mode, split by county, and whether every one has been classified.
function sample(rows, direction, mode, counties) {
  const own = rows.filter((r) => r.direction === direction && r.mode === mode);
  const byCounty = Object.fromEntries(counties.map((c) => [c, own.filter((r) => r.county === c)]));
  const expected = counties.reduce((sum, c) => sum + Math.max(PICKS_PER_CELL, byCounty[c].length), 0);
  const classified = own.filter((r) => r.classification).length;
  const short = counties.filter((c) => byCounty[c].length < PICKS_PER_CELL);
  return {
    rows: own,
    byCounty,
    expected,
    classified,
    // The borderline rule may be used once per measure; 10 more checks make a cell hold 15.
    extended: own.length > counties.length * PICKS_PER_CELL,
    pending: classified < expected ? `${classified} of ${expected} classified${short.length ? `; ${short.join(' and ')} short of ${PICKS_PER_CELL} rows` : ''}` : null,
  };
}

function judge({ measure, mode, scope, county = null, pct, n, of, pending = null, extended = false, canBorderline = false }) {
  const check = { measure, mode, scope, county, pct, n, of, required: required(pct, of) };
  if (pending) return { ...check, status: 'pending', note: pending };
  if (of === 0) return { ...check, status: 'fail', note: 'nothing to measure' };
  if (n >= check.required) return { ...check, status: 'pass' };
  return { ...check, status: canBorderline && !extended && n === check.required - 1 ? 'borderline' : 'fail' };
}

const count = (rows, test) => rows.filter(test).length;

export function scoreEvaluation({ rows, cells }) {
  const counties = [...new Set(cells.map((c) => c.county))].sort();
  const checks = [];

  for (const mode of MODES) {
    const coverage = sample(rows, PUBLIC_TO_PROVIDER, mode, counties);
    const available = sample(rows, PROVIDER_TO_PUBLIC, mode, counties);
    const found = coverage.rows.filter((r) => r.classification === 'found');

    const sampled = [
      { measure: 'Coverage', t: THRESHOLDS.coverage, group: coverage, hit: (r) => r.classification === 'found' },
      { measure: 'Still available', t: THRESHOLDS.stillAvailable, group: available, hit: (r) => r.classification === 'available' },
    ];
    for (const { measure, t, group, hit } of sampled) {
      checks.push(judge({ measure, mode, scope: 'pooled', pct: t.pooled, n: count(group.rows, hit), of: group.pending ? group.expected : group.rows.length, pending: group.pending, extended: group.extended, canBorderline: true }));
      for (const county of counties) {
        const own = group.byCounty[county];
        checks.push(judge({ measure, mode, scope: 'floor', county, pct: t.floor, n: count(own, hit), of: group.pending ? Math.max(PICKS_PER_CELL, own.length) : own.length, pending: group.pending }));
      }
    }

    // Status and price are judged over the listings found in the coverage check, so they wait for it.
    const agreements = [
      { measure: 'Status agrees', t: THRESHOLDS.statusAgrees, hit: (r) => r.publicGroup === r.providerGroup },
      { measure: 'Price agrees, within 1%', t: THRESHOLDS.priceAgrees, hit: (r) => withinOnePercent(r.providerPrice, r.publicPrice) },
    ];
    for (const { measure, t, hit } of agreements) {
      checks.push(judge({ measure, mode, scope: 'pooled', pct: t.pooled, n: count(found, hit), of: found.length, pending: coverage.pending && 'waits for the coverage check', extended: coverage.extended, canBorderline: true }));
    }
  }

  // Measured over every pulled active listing, so each county-and-mode cell is judged on its own.
  for (const cell of cells) {
    const incomplete = cell.complete ? null : 'search did not finish; the pull covers only the pages saved';
    const perCell = [
      { measure: 'Freshness: last seen within 7 days', t: THRESHOLDS.freshness, share: cell.seenWithin7Days },
      { measure: 'Verification: MLS number or agent contact', t: THRESHOLDS.verification, share: cell.mlsOrContact },
    ];
    for (const { measure, t, share } of perCell) {
      checks.push(judge({ measure, mode: cell.mode, scope: 'cell', county: cell.county, pct: t.cell, n: share.n, of: share.of, pending: incomplete }));
    }
  }
  return { counties, checks, decision: decide(checks, counties) };
}

// The plan's decision table, applied literally. Rows can overlap (a county-only failure in Rent matches rows 2
// and 3; a county-only failure in Buy matches rows 3 and 4) and the plan doesn't rank them, so all are returned.
export function decide(checks, counties) {
  const open = checks.filter((c) => c.status === 'pending' || c.status === 'borderline');
  if (open.length) return { ready: false, open: open.length, rows: [] };

  const failures = (mode) => checks.filter((c) => c.mode === mode && c.status === 'fail');
  const [buy, rent] = [failures('sale'), failures('rental')];
  const rows = [];
  if (!buy.length && !rent.length) rows.push({ row: 1, text: 'Every measure passes, in both modes, with every floor met: Go, build Milestones 1-3 on RentCast.' });
  if (!buy.length && rent.length) rows.push({ row: 2, text: 'Buy passes everything; Rent fails: Go for purchase listings; Rent-mode data may feed local comps, but Rent-mode search is not relied on for finding rentals.' });
  for (const mode of MODES) {
    const failed = failures(mode);
    // One county fails a floor or per-cell measure and the other county has no such failure.
    const failing = [...new Set(failed.filter((c) => c.scope !== 'pooled').map((c) => c.county))];
    if (failing.length === 1 && counties.length === 2) {
      const passing = counties.find((c) => c !== failing[0]);
      const label = MODE_LABEL[mode];
      // The plan doesn't say whether a failed pooled measure keeps the other county from "passing everything",
      // so the row is listed with that caveat rather than dropped.
      const caveat = failed.some((c) => c.scope === 'pooled') ? ' A pooled measure also fails in this mode, and the plan does not say whether row 3 still applies; decide whether the failing county alone explains it.' : '';
      rows.push({ row: 3, text: `${failing[0]} fails in ${label} while ${passing} passes its floors and per-cell measures in ${label}: Go in ${passing} for ${label} only, or test another provider for ${failing[0]}.${caveat}` });
    }
  }
  if (buy.length) rows.push({ row: 4, text: 'Buy fails: test another provider, or fall back to manual-add mode.' });
  return { ready: true, open: 0, rows };
}

const RESULT = { pass: 'PASS', fail: 'FAIL', pending: 'PENDING', borderline: 'BORDERLINE' };

function resultText(c) {
  if (c.status === 'borderline') return 'BORDERLINE: missed by one. Check 10 more for this mode and direction (5 per county, new random picks), then score again';
  return c.note ? `${RESULT[c.status]} (${c.note})` : RESULT[c.status];
}

const row = (cells) => `| ${cells.join(' | ')} |`;
const table = (head, body) => [row(head), row(head.map(() => '---')), ...body.map(row)].join('\n');

// Nothing to count yet (status and price wait for the coverage check), so don't print "0 of 0".
const tally = (c) => (c.status === 'pending' && !c.of ? ['not yet', 'not yet'] : [`${c.n} of ${c.of}`, `${c.required} (${c.pct}%)`]);

// Markdown, counts only, ready to paste into docs/PROVIDER_EVALUATION.md.
export function formatScore({ checks, decision }, rows = []) {
  const out = [];
  const pooled = checks.filter((c) => c.scope === 'pooled');
  out.push('Pooled measures (per mode, both counties)', '', table(['Measure', 'Mode', 'Count', 'Required', 'Result'], pooled.map((c) => [c.measure, MODE_LABEL[c.mode], ...tally(c), resultText(c)])));

  const floors = checks.filter((c) => c.scope === 'floor');
  out.push('', 'Floors (each county and mode)', '', table(['Measure', 'County', 'Mode', 'Count', 'Required', 'Result'], floors.map((c) => [c.measure, c.county, MODE_LABEL[c.mode], ...tally(c), resultText(c)])));

  const cells = checks.filter((c) => c.scope === 'cell');
  out.push('', 'Measures over all pulled active listings (each county and mode)', '', table(['Measure', 'County', 'Mode', 'Count', 'Required', 'Result'], cells.map((c) => [c.measure, c.county, MODE_LABEL[c.mode], ...tally(c), resultText(c)])));

  const seeds = [PUBLIC_TO_PROVIDER, PROVIDER_TO_PUBLIC].flatMap((direction) => MODES.map((mode) => {
    const used = [...new Set(rows.filter((r) => r.direction === direction && r.mode === mode).map((r) => r.seed).filter(Boolean))];
    return [direction === PUBLIC_TO_PROVIDER ? 'Coverage (public to provider)' : 'Still available (provider to public)', MODE_LABEL[mode], used.length ? used.join(', ') : 'none recorded'];
  }));
  out.push('', 'Seeds in the record sheets', '', table(['Check', 'Mode', 'Seeds'], seeds));

  out.push('', 'Decision table');
  if (!decision.ready) out.push('', `Not decidable yet: ${decision.open} measure${decision.open === 1 ? '' : 's'} still pending or borderline.`);
  else {
    out.push('', ...decision.rows.map((r) => `- Row ${r.row}: ${r.text}`));
    if (decision.rows.length > 1) out.push('', 'More than one row applies. The plan does not say which wins; record which one you take and why.');
  }

  if (checks.some((c) => c.scope === 'floor' && c.status !== 'pending' && c.of > PICKS_PER_CELL)) {
    out.push('', 'Note: a cell holds more than 10 checks, so a borderline extension was used. The plan judges the pooled measure on all 30 "at the same percentage" but does not restate the floor for 15 checks in a cell; the floor above uses the same percentage of the checks in that cell, rounded up.');
  }
  return out.join('\n');
}
