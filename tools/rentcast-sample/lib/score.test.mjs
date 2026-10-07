import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, formatScore, required, scoreEvaluation, withinOnePercent } from './score.mjs';
import { PROVIDER_TO_PUBLIC, PUBLIC_TO_PROVIDER } from './sheet.mjs';

// Everything here is invented: two made-up counties, rows with no addresses.
const COUNTIES = ['Alpha', 'Beta'];
const share = (n, of) => ({ n, of });
const cell = (county, mode, { seen = share(10, 10), mls = share(10, 10), complete = true } = {}) => ({ county, mode, complete, seenWithin7Days: seen, mlsOrContact: mls });
const goodCells = () => COUNTIES.flatMap((county) => MODES.map((mode) => cell(county, mode)));

let line = 2;
const found = { publicGroup: 'Active', providerGroup: 'Active', publicPrice: 100000, providerPrice: 100000 };
// `results` is a list like ['found', 'found', 'not found']; found rows get matching status and price unless `extra` says otherwise.
const rowsFor = (direction, mode, county, results, extra = {}, seed = '1111') =>
  results.map((classification) => ({ line: line++, county, mode, direction, seed, classification, ...(direction === PUBLIC_TO_PROVIDER && classification === 'found' ? { ...found, ...extra } : {}) }));
const repeat = (value, n) => Array(n).fill(value);
// n of `hit` followed by (total - n) of `miss`
const split = (hit, n, miss, total = 10) => [...repeat(hit, n), ...repeat(miss, total - n)];

function cov(mode, perCounty, extra) {
  return COUNTIES.flatMap((county, i) => rowsFor(PUBLIC_TO_PROVIDER, mode, county, split('found', perCounty[i], 'not found', 10), extra));
}
function avail(mode, perCounty) {
  return COUNTIES.flatMap((county, i) => rowsFor(PROVIDER_TO_PUBLIC, mode, county, split('available', perCounty[i], 'not available', 10)));
}
// A sheet where every sampled measure passes comfortably, to be bent one way at a time.
const allGood = () => MODES.flatMap((mode) => [...cov(mode, [10, 10]), ...avail(mode, [10, 10])]);
const without = (rows, direction, mode) => rows.filter((r) => !(r.direction === direction && r.mode === mode));

const get = (result, where) => result.checks.find((c) => Object.entries(where).every(([k, v]) => c[k] === v));

test('required counts round up, and match the plan\'s table', () => {
  assert.equal(required(80, 20), 16); // coverage, pooled
  assert.equal(required(85, 20), 17); // still available, pooled
  assert.equal(required(70, 10), 7); //  coverage floor
  assert.equal(required(80, 10), 8); //  still-available floor
  assert.equal(required(90, 18), 17); // 16.2 rounds up
  assert.equal(required(85, 30), 26); // 25.5 rounds up
  assert.equal(required(80, 30), 24);
  assert.equal(required(75, 73), 55); //  54.75 rounds up
});

test('price agrees within 1%, and exactly 1% agrees', () => {
  assert.ok(withinOnePercent(101000, 100000));
  assert.ok(!withinOnePercent(101001, 100000));
  assert.ok(withinOnePercent(99000, 100000));
  assert.ok(!withinOnePercent(98999, 100000));
});

test('with every check passing, all measures pass and decision row 1 applies', () => {
  const result = scoreEvaluation({ rows: allGood(), cells: goodCells() });
  assert.ok(result.checks.every((c) => c.status === 'pass'), JSON.stringify(result.checks.filter((c) => c.status !== 'pass')));
  assert.deepEqual(result.decision.rows.map((r) => r.row), [1]);
  assert.equal(get(result, { measure: 'Coverage', mode: 'sale', scope: 'pooled' }).required, 16);
});

test('a pooled measure passes at exactly the required count and misses by one below it', () => {
  const at = scoreEvaluation({ rows: [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...cov('sale', [8, 8])], cells: goodCells() });
  assert.equal(get(at, { measure: 'Coverage', mode: 'sale', scope: 'pooled' }).status, 'pass'); // 16 of 20
  const below = scoreEvaluation({ rows: [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...cov('sale', [8, 7])], cells: goodCells() });
  const check = get(below, { measure: 'Coverage', mode: 'sale', scope: 'pooled' });
  assert.equal(check.n, 15);
  assert.equal(check.status, 'borderline'); // required 16, missed by exactly one
  assert.equal(below.decision.ready, false);
});

test('a pooled miss by two is a plain fail, not borderline', () => {
  const rows = [...without(allGood(), PROVIDER_TO_PUBLIC, 'rental'), ...avail('rental', [8, 7])]; // 15 of 20, required 17
  const result = scoreEvaluation({ rows, cells: goodCells() });
  assert.equal(get(result, { measure: 'Still available', mode: 'rental', scope: 'pooled' }).status, 'fail');
});

test('not found, ambiguous, and not available all count as not available', () => {
  const sheet = (misses) => COUNTIES.flatMap((county) => rowsFor(PROVIDER_TO_PUBLIC, 'sale', county, ['available', ...misses, ...repeat('available', 10 - 1 - misses.length)]));
  const result = scoreEvaluation({ rows: [...without(allGood(), PROVIDER_TO_PUBLIC, 'sale'), ...sheet(['not available', 'not found', 'ambiguous'])], cells: goodCells() });
  assert.equal(get(result, { measure: 'Still available', mode: 'sale', scope: 'floor', county: 'Alpha' }).n, 7);
  assert.equal(get(result, { measure: 'Still available', mode: 'sale', scope: 'pooled' }).n, 14);
});

test('a floor fails one county even when the pooled measure passes', () => {
  // 10 + 6 = 16 of 20 passes the pooled coverage measure; Beta's 6 of 10 is under the floor of 7.
  const rows = [...without(allGood(), PUBLIC_TO_PROVIDER, 'rental'), ...cov('rental', [10, 6])];
  const result = scoreEvaluation({ rows, cells: goodCells() });
  assert.equal(get(result, { measure: 'Coverage', mode: 'rental', scope: 'pooled' }).status, 'pass');
  assert.equal(get(result, { measure: 'Coverage', mode: 'rental', scope: 'floor', county: 'Beta' }).status, 'fail');
  assert.equal(get(result, { measure: 'Coverage', mode: 'rental', scope: 'floor', county: 'Alpha' }).status, 'pass');
});

test('the still-available floor is 8 of 10: 8 passes, 7 fails, even though 17 of 20 passes the pooled measure', () => {
  const rows = [...without(allGood(), PROVIDER_TO_PUBLIC, 'sale'), ...avail('sale', [10, 7])];
  const result = scoreEvaluation({ rows, cells: goodCells() });
  assert.equal(get(result, { measure: 'Still available', mode: 'sale', scope: 'pooled' }).status, 'pass'); // 17 of 20
  assert.equal(get(result, { measure: 'Still available', mode: 'sale', scope: 'floor', county: 'Beta' }).status, 'fail');
  const eight = scoreEvaluation({ rows: [...without(allGood(), PROVIDER_TO_PUBLIC, 'sale'), ...avail('sale', [10, 8])], cells: goodCells() });
  assert.equal(get(eight, { measure: 'Still available', mode: 'sale', scope: 'floor', county: 'Beta' }).status, 'pass');
});

test('status agrees compares groups, and is judged over the listings found', () => {
  // 20 found; two in Beta are under contract on the public site while the provider still says active.
  const rows = [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...cov('sale', [10, 8]), ...rowsFor(PUBLIC_TO_PROVIDER, 'sale', 'Beta', ['found', 'found'], { publicGroup: 'Under contract' })];
  const status = get(scoreEvaluation({ rows, cells: goodCells() }), { measure: 'Status agrees', mode: 'sale' });
  assert.equal(status.of, 20); // 10 + 8 + 2 found
  assert.equal(status.n, 18);
  assert.equal(status.required, 18); // 90% of 20
  assert.equal(status.status, 'pass');
});

test('price agrees counts a gap over 1% as a disagreement, and one short of the required count is borderline', () => {
  // 20 found rentals; the provider's price for 3 of them is 3% above the public price. 17 of 20 agree; 18 are required.
  const rental = cov('rental', [10, 10]).map((r, i) => (i < 3 ? { ...r, providerPrice: 103000 } : r));
  const price = get(scoreEvaluation({ rows: [...without(allGood(), PUBLIC_TO_PROVIDER, 'rental'), ...rental], cells: goodCells() }), { measure: 'Price agrees, within 1%', mode: 'rental' });
  assert.deepEqual([price.n, price.of, price.required, price.status], [17, 20, 18, 'borderline']);
});

test('status and price wait for the coverage check, and nothing is decided while any measure is open', () => {
  const noCoverage = allGood().filter((r) => r.direction !== PUBLIC_TO_PROVIDER);
  const result = scoreEvaluation({ rows: noCoverage, cells: goodCells() });
  assert.equal(get(result, { measure: 'Coverage', mode: 'sale', scope: 'pooled' }).status, 'pending');
  assert.equal(get(result, { measure: 'Status agrees', mode: 'sale' }).status, 'pending');
  assert.equal(result.decision.ready, false);
  assert.deepEqual(result.decision.rows, []);
});

test('unclassified rows leave a measure pending, with how many are done', () => {
  const rows = [...without(allGood(), PROVIDER_TO_PUBLIC, 'sale'), ...COUNTIES.flatMap((county) => rowsFor(PROVIDER_TO_PUBLIC, 'sale', county, [...repeat('available', 6), ...repeat(null, 4)]))];
  const check = get(scoreEvaluation({ rows, cells: goodCells() }), { measure: 'Still available', mode: 'sale', scope: 'pooled' });
  assert.equal(check.status, 'pending');
  assert.match(check.note, /12 of 20 classified/);
});

test('fewer than 10 rows in a county is pending, not a pass', () => {
  const rows = [...without(allGood(), PROVIDER_TO_PUBLIC, 'sale'), ...rowsFor(PROVIDER_TO_PUBLIC, 'sale', 'Alpha', repeat('available', 10)), ...rowsFor(PROVIDER_TO_PUBLIC, 'sale', 'Beta', repeat('available', 4))];
  const check = get(scoreEvaluation({ rows, cells: goodCells() }), { measure: 'Still available', mode: 'sale', scope: 'pooled' });
  assert.equal(check.status, 'pending');
  assert.match(check.note, /Beta short of 10 rows/);
});

test('after the borderline extension the pooled measure is judged on all 30, and misses by one are final', () => {
  // 15 checks per county. 12 + 12 = 24 of 30 meets the required 24; 12 + 11 = 23 does not.
  const extended = (perCounty) => COUNTIES.flatMap((county, i) => rowsFor(PUBLIC_TO_PROVIDER, 'sale', county, split('found', perCounty[i], 'not found', 15)));
  const at = scoreEvaluation({ rows: [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...extended([12, 12])], cells: goodCells() });
  const pooled = get(at, { measure: 'Coverage', mode: 'sale', scope: 'pooled' });
  assert.deepEqual([pooled.n, pooled.of, pooled.required, pooled.status], [24, 30, 24, 'pass']);
  assert.equal(get(at, { measure: 'Coverage', mode: 'sale', scope: 'floor', county: 'Alpha' }).required, 11); // 70% of 15, rounded up
  assert.match(formatScore(at), /borderline extension was used/);

  const short = scoreEvaluation({ rows: [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...extended([12, 11])], cells: goodCells() });
  assert.equal(get(short, { measure: 'Coverage', mode: 'sale', scope: 'pooled' }).status, 'fail'); // once per measure: no second extension
});

test('freshness and verification are judged in every county-and-mode cell', () => {
  const cells = goodCells().map((c) => (c.county === 'Beta' && c.mode === 'rental' ? { ...c, seenWithin7Days: share(8, 10), mlsOrContact: share(3, 4) } : c));
  const result = scoreEvaluation({ rows: allGood(), cells });
  const fresh = get(result, { measure: 'Freshness: last seen within 7 days', county: 'Beta', mode: 'rental' });
  assert.deepEqual([fresh.required, fresh.status], [9, 'fail']); // 90% of 10; 8 is short
  assert.equal(get(result, { measure: 'Verification: MLS number or agent contact', county: 'Beta', mode: 'rental' }).status, 'pass'); // 3 of 4 is exactly 75%
  assert.equal(get(result, { measure: 'Freshness: last seen within 7 days', county: 'Alpha', mode: 'rental' }).status, 'pass');
  const low = scoreEvaluation({ rows: allGood(), cells: goodCells().map((c) => (c.county === 'Alpha' && c.mode === 'sale' ? { ...c, mlsOrContact: share(2, 4) } : c)) });
  assert.equal(get(low, { measure: 'Verification: MLS number or agent contact', county: 'Alpha', mode: 'sale' }).status, 'fail'); // 50% is under 75%
});

test('an unfinished search, or one with no active listings, cannot pass its cell', () => {
  const cells = goodCells().map((c) => (c.county === 'Alpha' && c.mode === 'sale' ? { ...c, complete: false } : c.county === 'Beta' && c.mode === 'sale' ? { ...c, seenWithin7Days: share(0, 0) } : c));
  const result = scoreEvaluation({ rows: allGood(), cells });
  assert.equal(get(result, { measure: 'Freshness: last seen within 7 days', county: 'Alpha', mode: 'sale' }).status, 'pending');
  assert.equal(get(result, { measure: 'Freshness: last seen within 7 days', county: 'Beta', mode: 'sale' }).status, 'fail');
});

test('decision row 2: Buy passes, Rent fails on a pooled measure', () => {
  const rows = [...without(allGood(), PUBLIC_TO_PROVIDER, 'rental'), ...cov('rental', [6, 6])]; // 12 of 20, floors 6 of 10 also fail
  assert.deepEqual(scoreEvaluation({ rows, cells: goodCells() }).decision.rows.map((r) => r.row), [2]);
});

test('decision rows 2 and 3 both apply when only one county fails in Rent', () => {
  const rows = [...without(allGood(), PUBLIC_TO_PROVIDER, 'rental'), ...cov('rental', [10, 6])]; // pooled 16 passes; Beta floor fails
  const { decision } = scoreEvaluation({ rows, cells: goodCells() });
  assert.deepEqual(decision.rows.map((r) => r.row), [2, 3]);
  assert.match(decision.rows[1].text, /Beta fails in Rent while Alpha passes/);
});

test('decision row 4: Buy fails on a pooled measure', () => {
  const rows = [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...cov('sale', [6, 6])];
  assert.deepEqual(scoreEvaluation({ rows, cells: goodCells() }).decision.rows.map((r) => r.row), [4]);
});

test('row 3 is not offered when both counties are only just short: 7 and 7 pass each floor but miss the pooled 16', () => {
  const rows = [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...cov('sale', [7, 7])];
  const result = scoreEvaluation({ rows, cells: goodCells() });
  assert.equal(get(result, { measure: 'Coverage', mode: 'sale', scope: 'pooled' }).status, 'fail');
  assert.deepEqual(result.decision.rows.map((r) => r.row), [4]);
});

test('row 3 is listed with a caveat when one county fails its floor and a pooled measure fails too', () => {
  const rows = [...without(allGood(), PUBLIC_TO_PROVIDER, 'sale'), ...cov('sale', [10, 4])]; // pooled 14 of 20 fails; Beta 4 of 10 fails its floor
  const { decision } = scoreEvaluation({ rows, cells: goodCells() });
  assert.deepEqual(decision.rows.map((r) => r.row), [3, 4]);
  assert.match(decision.rows[0].text, /Beta fails in Buy while Alpha passes/);
  assert.match(decision.rows[0].text, /plan does not say whether row 3 still applies/);
});

test('rows 3 and 4 both apply when only one county fails in Buy, and the output says the plan does not rank them', () => {
  const cells = goodCells().map((c) => (c.county === 'Beta' && c.mode === 'sale' ? { ...c, mlsOrContact: share(2, 10) } : c));
  const result = scoreEvaluation({ rows: allGood(), cells });
  assert.deepEqual(result.decision.rows.map((r) => r.row), [3, 4]);
  assert.match(formatScore(result), /does not say which wins/);
});

test('the output has counts, results, and seeds, and says nothing is decidable while checks are open', () => {
  const rows = allGood().filter((r) => r.direction !== PUBLIC_TO_PROVIDER).map((r) => ({ ...r, seed: '76915740' }));
  const text = formatScore(scoreEvaluation({ rows, cells: goodCells() }), rows);
  assert.match(text, /\| Still available \| Buy \| 20 of 20 \| 17 \(85%\) \| PASS \|/);
  assert.match(text, /\| Coverage \| Buy \| 0 of 20 \| 16 \(80%\) \| PENDING/);
  assert.match(text, /\| Status agrees \| Buy \| not yet \| not yet \| PENDING/);
  assert.match(text, /Still available \(provider to public\) \| Buy \| 76915740/);
  assert.match(text, /Coverage \(public to provider\) \| Buy \| none recorded/);
  assert.match(text, /Not decidable yet: \d+ measures still pending/);
});
