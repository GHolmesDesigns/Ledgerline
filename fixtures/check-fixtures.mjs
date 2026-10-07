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

// Estimate labels name the first two Est. lines in the plan's order (Total status), then "+n".
function estimateItem(p, l) {
  const association = ['hoa', 'condo', 'coop'].includes(p.association?.status);
  const highRiskFlood = !p.floodZone || /^[AV]/.test(p.floodZone);
  switch (l.line) {
    case 'hoa': return p.type === 'single_family' ? [7, 'HOA not confirmed'] : [1, 'HOA confirmation'];
    case 'homeowners': return [2, 'insurance quote'];
    case 'ho6': return [2, 'HO-6 quote'];
    case 'flood': return [highRiskFlood ? 3 : 5, 'flood quote'];
    case 'specialAssessment': return [association ? 4 : 8, 'assessments not checked'];
    case 'nonAdValorem': return [6, 'CDD not checked'];
    default: return [9, l.line];
  }
}
function estimateLabel(p) {
  const items = p.costLines.filter((l) => l.state === 'est').map((l) => estimateItem(p, l)).sort((a, b) => a[0] - b[0]);
  const more = items.length - 2;
  return 'Estimate · needs ' + items.slice(0, 2).map((i) => i[1]).join(', ') + (more > 0 ? ' +' + more : '');
}

const W = data.rankingWeights.buy;
function score(factors) {
  // Unknown factors (null) score as the worst value: 0.
  return Math.round(Object.keys(W).reduce((a, k) => a + (factors[k] == null ? 0 : W[k] * factors[k] / 100), 0));
}

// Lines priced from a county's local rates.
const COUNTY_RATE_LINES = ['propertyTax', 'homeowners', 'ho6', 'flood', 'nonAdValorem'];
const INCOMPLETE_TRIGGERS = (p, line) => {
  // The four triggers in the plan (section 5) for an Unknown line.
  if (!p.inConfiguredMarket && COUNTY_RATE_LINES.includes(line.line)) return true; // county without local rates
  if (line.line === 'specialAssessment' && /pending|approved/i.test(p.association?.specialAssessment || '')) return true;
  if (line.line === 'nonAdValorem' && p.association?.knownCdd && line.monthly == null) return true;
  // No listing fee and no same-building median (needs at least 2 other units).
  if (line.line === 'hoa' && ['condo', 'coop', 'townhome'].includes(p.type) && (p.association?.sameBuildingUnits ?? 0) < 2) return true;
  return false;
};

for (const p of data.properties) {
  const sale = p.listings.find((l) => l.mode === 'sale');
  const price = sale.price;
  const lc = local[p.county];
  const byLine = Object.fromEntries(p.costLines.map((l) => [l.line, l]));
  const tag = p.id;

  // Townhomes use the house homeowners default; condos use HO-6.
  const ins = { single_family: 'homeowners', townhome: 'homeowners', condo: 'ho6' }[p.type];
  const notIns = ins === 'ho6' ? 'homeowners' : 'ho6';
  if (ins && (!byLine[ins] || byLine[notIns])) fail(`${tag} ${p.type} must have a ${ins} line and no ${notIns} line`);

  // Calculated lines must match the formulas.
  const pi = Math.round(principalInterest(price));
  if (byLine.principalInterest.monthly !== pi) fail(`${tag} P&I ${byLine.principalInterest.monthly} ≠ ${pi}`);
  const mt = Math.round(price * P.maintenancePctPerYear / 100 / 12 + 1e-9);
  if (byLine.maintenance.monthly !== mt) fail(`${tag} maintenance ${byLine.maintenance.monthly} ≠ ${mt}`);
  if (lc && lc.set) {
    const tax = Math.round(price * lc.millage / 1000 / 12);
    if (byLine.propertyTax.state !== 'calc' || byLine.propertyTax.monthly !== tax) fail(`${tag} tax ≠ ${tax} Calc`);
    // Est. lines use the county's local defaults.
    const defaults = {
      homeowners: lc.homeownersDefaultMonthly,
      ho6: lc.ho6DefaultMonthly,
      flood: lc.floodDefaultMonthly[p.floodZone],
      nonAdValorem: Math.round(lc.typicalNonAdValoremPerYear / 12),
    };
    for (const [k, want] of Object.entries(defaults)) {
      if (want != null && byLine[k]?.state === 'est' && byLine[k].monthly !== want) fail(`${tag} Est. ${k} ${byLine[k].monthly} ≠ ${p.county} default ${want}`);
    }
  } else {
    // No county rates: these lines can't be Calc or Est. A property's own Quote still stands.
    for (const k of ['propertyTax', 'homeowners', 'ho6', 'flood']) {
      if (byLine[k] && ['calc', 'est'].includes(byLine[k].state)) fail(`${tag} ${k} uses county rates, but ${p.county} has none`);
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
  // Estimate labels name two lines in the plan's order, then "+n" for the rest.
  if (p.expected.totalStatus === 'estimate' && p.expected.statusLabel !== estimateLabel(p)) fail(`${tag} label "${p.expected.statusLabel}" ≠ "${estimateLabel(p)}"`);
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
const salePrice = (p) => p.listings.find((l) => l.mode === 'sale').price;
const byPrice = [...data.properties].sort((a, b) => salePrice(a) - salePrice(b));
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

// The fixtures follow one plan version (plan, Version history).
const plan = readFileSync(join(here, '..', 'PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.md'), 'utf8');
const planVersion = plan.match(/^\*Version (\d+\.\d+) ·/m)?.[1];
if (data.planVersion !== planVersion) fail(`planVersion ${data.planVersion} ≠ plan version ${planVersion}; recheck the fixtures against the plan, then update planVersion`);
else ok(`fixtures follow plan version ${planVersion}`);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll fixture checks passed.');
