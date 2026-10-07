// Recomputes every derived number in sample-data.json and checks the plan's rules.
// Run from the project root:  node fixtures/check-fixtures.mjs
// Exit code 0 = all checks pass. No dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'sample-data.json'), 'utf8'));
let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL  ' + msg); };
const ok = (msg) => console.log('ok    ' + msg);
const money = (v) => '$' + Math.round(Math.abs(v)).toLocaleString('en-US');

const P = data.personalAssumptions;
const local = Object.fromEntries(data.localAssumptions.map((l) => [l.county, l]));

function principalInterest(price) {
  const loan = price * (1 - P.downPaymentPct / 100);
  const r = P.mortgageRatePct / 100 / 12, n = P.termYears * 12;
  return loan * r / (1 - Math.pow(1 + r, -n));
}

// Total status = weakest line state (N/A ignored).
function totalStatus(lines) {
  if (lines.some((l) => l.state === 'unknown')) return 'incomplete';
  if (lines.some((l) => l.state === 'est')) return 'estimate';
  return 'calculated';
}

const W = data.rankingWeights.buy;
function score(factors) {
  // Unknown factors (null) score as the worst value: 0.
  return Math.round(Object.keys(W).reduce((a, k) => a + (factors[k] == null ? 0 : W[k] * factors[k] / 100), 0));
}

const INCOMPLETE_TRIGGERS = (p, line) => {
  // The four triggers in the plan (section 5) for an Unknown line.
  if (!p.inConfiguredMarket) return true; // county without local rates
  if (line.line === 'specialAssessment' && /pending|approved/i.test(p.association?.specialAssessment || '')) return true;
  if (line.line === 'nonAdValorem' && p.association?.knownCdd && line.monthly == null) return true;
  if (line.line === 'hoa' && ['condo', 'coop', 'townhome'].includes(p.type)) return true;
  return false;
};

for (const p of data.properties) {
  const sale = p.listings.find((l) => l.mode === 'sale');
  const price = sale.price;
  const lc = local[p.county];
  const byLine = Object.fromEntries(p.costLines.map((l) => [l.line, l]));
  const tag = p.id;

  // Calculated lines must match the formulas.
  const pi = Math.round(principalInterest(price));
  if (byLine.principalInterest.monthly !== pi) fail(`${tag} P&I ${byLine.principalInterest.monthly} ≠ ${pi}`);
  const mt = Math.round(price * P.maintenancePctPerYear / 100 / 12 + 1e-9);
  if (byLine.maintenance.monthly !== mt) fail(`${tag} maintenance ${byLine.maintenance.monthly} ≠ ${mt}`);
  if (lc && lc.set) {
    const tax = Math.round(price * lc.millage / 1000 / 12);
    if (byLine.propertyTax.state !== 'calc' || byLine.propertyTax.monthly !== tax) fail(`${tag} tax ≠ ${tax} Calc`);
  } else {
    for (const k of ['propertyTax', 'homeowners', 'ho6', 'flood']) {
      if (byLine[k] && byLine[k].state !== 'unknown') fail(`${tag} ${k} must be Unknown outside configured markets`);
    }
  }
  // Doc-sourced CDD from an annual amount.
  if (byLine.nonAdValorem.state === 'doc' && /\$([\d,]+)\/yr/.test(byLine.nonAdValorem.note || '')) {
    const yr = Number(RegExp.$1.replace(/,/g, ''));
    if (Math.round(yr / 12) !== byLine.nonAdValorem.monthly) fail(`${tag} CDD monthly ≠ annual ÷ 12`);
  }
  // Unknown lines only for the four triggers; Est. $0 must say "not checked"/"not confirmed".
  for (const l of p.costLines) {
    if (l.state === 'unknown' && !INCOMPLETE_TRIGGERS(p, l)) fail(`${tag} ${l.line} is Unknown without one of the four triggers`);
    if (l.state === 'est' && l.monthly === 0 && !/not (checked|confirmed)/.test(l.note || '')) fail(`${tag} ${l.line} Est. $0 must be labeled "not checked"/"not confirmed"`);
    if (l.state === 'na' && l.monthly !== 0) fail(`${tag} ${l.line} N/A must count as $0`);
  }
  // Non-ad valorem precedence: Doc beats everything; outside configured counties it is Unknown otherwise.
  if (!p.inConfiguredMarket && !['doc', 'unknown'].includes(byLine.nonAdValorem.state)) fail(`${tag} non-ad valorem must be Doc or Unknown without county rates`);
  // Estimate labels name up to two lines, then "+n" for the rest.
  const estCount = p.costLines.filter((l) => l.state === 'est').length;
  if (p.expected.totalStatus === 'estimate') {
    const m = p.expected.statusLabel.match(/ \+(\d+)$/);
    const want = Math.max(0, estCount - 2);
    if ((m ? Number(m[1]) : 0) !== want) fail(`${tag} label "${p.expected.statusLabel}" should end with ${want ? '+' + want : 'no +n'} (${estCount} Est. lines)`);
  }
  // A single-family home in a configured county is never Incomplete.
  const st = totalStatus(p.costLines);
  if (p.type === 'single_family' && p.inConfiguredMarket && st === 'incomplete') fail(`${tag} single-family in configured county is Incomplete`);
  if (st !== p.expected.totalStatus) fail(`${tag} status ${st} ≠ expected ${p.expected.totalStatus}`);

  const known = p.costLines.reduce((a, l) => a + (l.monthly ?? 0), 0);
  if (st === 'incomplete') {
    if (known !== p.expected.knownSubtotal) fail(`${tag} known subtotal ${known} ≠ ${p.expected.knownSubtotal}`);
  } else if (known !== p.expected.monthlyTotal) fail(`${tag} total ${known} ≠ ${p.expected.monthlyTotal}`);

  // Own-vs-rent gap: hidden when Incomplete or rent Unavailable; "≈" when Estimate.
  const rentOk = p.rent.source !== 'unavailable' && p.rent.value != null;
  if (st === 'incomplete' || !rentOk) {
    if (p.expected.gapLabel !== null) fail(`${tag} gap must be hidden`);
  } else {
    const d = known - p.rent.value;
    const label = (st === 'estimate' ? '≈ ' : '') + (d >= 0 ? '+' : '−') + money(d) + '/mo';
    if (label !== p.expected.gapLabel) fail(`${tag} gap "${p.expected.gapLabel}" ≠ "${label}"`);
  }
  if (rentOk && p.rent.source === 'local_comps' && p.rent.compCount < data.comparableRentRules.minComps) fail(`${tag} fewer than min comps but rent shown`);

  // Upfront cash = down payment (+ one-time assessments when known).
  const down = price * P.downPaymentPct / 100;
  if (p.expected.upfrontCash != null && p.expected.upfrontCash !== down) fail(`${tag} upfront ${p.expected.upfrontCash} ≠ ${down}`);

  // Score and provisional status.
  const sc = score(p.factors);
  if (sc !== p.expected.score) fail(`${tag} score ${sc} ≠ ${p.expected.score}`);
  const prov = Object.values(p.factors).some((v) => v == null) || p.flags.length > 0;
  if (prov !== p.expected.provisional) fail(`${tag} provisional ${prov} ≠ ${p.expected.provisional}`);
  if (!failures) ok(`${tag}: ${st}, ${st === 'incomplete' ? 'at least ' : ''}${money(known)}/mo, score ${sc}${prov ? ' (provisional)' : ''}`);
}

// Ranks follow score order, whatever the sort.
const byScore = [...data.properties].sort((a, b) => score(b.factors) - score(a.factors));
byScore.forEach((p, i) => { if (p.expected.rank !== i + 1) fail(`${p.id} rank ${p.expected.rank} ≠ ${i + 1}`); });
const byPrice = [...data.properties].sort((a, b) => a.listings[0].price - b.listings[0].price);
const rankOf = Object.fromEntries(byScore.map((p, i) => [p.id, i + 1]));
byPrice.forEach((p, i) => {
  const [id, r] = data.priceSortExpectedRanks[i];
  if (id !== p.id || rankOf[p.id] !== r) fail(`price sort position ${i + 1}: expected ${id} #${r}, got ${p.id} #${rankOf[p.id]}`);
});
ok('ranks follow score order under score and price sorts');

// "Lowest" goes only to the lowest non-incomplete total in the shortlist.
const shortlist = data.compareShortlist.map((id) => data.properties.find((p) => p.id === id));
const eligible = shortlist.filter((p) => totalStatus(p.costLines) !== 'incomplete');
const lowest = eligible.sort((a, b) => a.expected.monthlyTotal - b.expected.monthlyTotal)[0];
if (lowest.id !== data.expectedCompareLowest) fail(`lowest ${lowest.id} ≠ ${data.expectedCompareLowest}`); else ok('compare "Lowest" skips incomplete totals');

// Rent comps median.
const comps = data.rentComps['ftl-2207-ne-32nd-ct'].map((c) => c.rent).sort((a, b) => a - b);
const median = (comps[1] + comps[2]) / 2;
if (median !== 5225) fail(`comp median ${median} ≠ 5225`); else ok('local comps median $5,225');

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll fixture checks passed.');
