import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_HEADER, PICKS_PER_CELL, hashSeed, pickCells, pickRandom, picksCsv } from './picks.mjs';
import { invented, makeRun } from '../test-support/helpers.mjs';

// 30 invented active sale listings and 25 rental ones, with one inactive listing in each.
const listings = (prefix, count) => Array.from({ length: count }, (_, i) => ({
  id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
  formattedAddress: `${i + 1} Sample Row, Sampleton, FL 00000`,
  status: 'Active',
  price: 100000 + i,
}));
const runWith = (area, county) => makeRun({ area, county, sale: [...listings(`${area}-s`, 30), { id: `${area}-off`, status: 'Inactive' }], rental: listings(`${area}-r`, 25) });
const ids = (cells) => cells.map((c) => c.picks.map((l) => l.id));

test('the same seed returns the same 10 listings per county and mode', () => {
  const runs = [runWith('alpha', 'Alpha'), runWith('beta', 'Beta')];
  const first = pickCells(runs, '12345678');
  const again = pickCells(runs, '12345678');
  assert.deepEqual(ids(first), ids(again));
  assert.equal(first.length, 4); // two counties x two modes
  for (const cell of first) assert.equal(cell.picks.length, PICKS_PER_CELL);
});

test('a different seed returns different picks', () => {
  const runs = [runWith('alpha', 'Alpha')];
  assert.notDeepEqual(ids(pickCells(runs, '12345678')), ids(pickCells(runs, '87654321')));
});

test('picks do not depend on the order the provider returned the listings', () => {
  const forward = runWith('alpha', 'Alpha');
  const reversed = runWith('alpha', 'Alpha');
  for (const search of reversed.searches) search.listings.reverse();
  assert.deepEqual(ids(pickCells([forward], 'seed-a')), ids(pickCells([reversed], 'seed-a')));
});

test('one cell\'s picks do not change when another cell is added', () => {
  const alone = pickCells([runWith('alpha', 'Alpha')], 'seed-b');
  const withBeta = pickCells([runWith('alpha', 'Alpha'), runWith('beta', 'Beta')], 'seed-b');
  assert.deepEqual(ids(alone), ids(withBeta).slice(0, 2));
});

test('picks are unique, active, and from that cell only', () => {
  const [sale, rental] = pickCells([runWith('alpha', 'Alpha')], 'seed-c');
  assert.equal(new Set(sale.picks.map((l) => l.id)).size, PICKS_PER_CELL);
  assert.ok(sale.picks.every((l) => l.status === 'Active' && l.id.startsWith('alpha-s-')));
  assert.ok(rental.picks.every((l) => l.id.startsWith('alpha-r-')));
  assert.equal(sale.poolSize, 30); // the inactive listing is not in the pool
});

test('a repeated listing across pages is only one candidate', () => {
  const dup = { id: 'dup', status: 'Active' };
  const [sale] = pickCells([makeRun({ sale: [dup, { ...dup }, { id: 'other', status: 'Active' }] })], 'seed-d');
  assert.equal(sale.poolSize, 2);
});

test('with fewer than 10 active listings, all are picked and none are replaced', () => {
  const [sale] = pickCells([makeRun({ sale: invented.sale })], 'seed-e'); // 7 active
  assert.equal(sale.picks.length, 7);
  assert.equal(sale.poolSize, 7);
});

test('pickRandom and hashSeed are stable', () => {
  assert.equal(hashSeed('12345678'), hashSeed(12345678));
  assert.deepEqual(pickRandom([1, 2, 3, 4, 5, 6], 3, 'x'), pickRandom([1, 2, 3, 4, 5, 6], 3, 'x'));
});

test('the sheet has the plan\'s columns and quotes awkward values', () => {
  const cells = pickCells([makeRun({ sale: [{ id: 'q-1', status: 'Active', formattedAddress: '1 Sample Row, "Unit 2", Sampleton, FL 00000', addressLine2: 'Unit 2', price: 5, mlsNumber: 'M1' }] })], 'seed-f');
  const lines = picksCsv(cells, 'seed-f').trim().split('\n');
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.equal(lines.length, 2); // the header and the one sale pick; the rental search is empty
  assert.match(lines[1], /^Alpha,sale,provider to public,seed-f,"1 Sample Row, ""Unit 2"", Sampleton, FL 00000",Unit 2,q-1,M1,Active,5,,,,$/);
});
