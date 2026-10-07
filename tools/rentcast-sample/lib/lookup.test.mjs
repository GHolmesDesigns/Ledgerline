import test from 'node:test';
import assert from 'node:assert/strict';
import { findCandidates, formatCandidates, streetTokens, unitKey } from './lookup.mjs';
import { makeRun } from '../test-support/helpers.mjs';

// All invented. The tower has three units; the house has none; "Sample Ct" shares a number with "Sample Ave".
const listing = (id, addressLine1, addressLine2, extra = {}) => ({ id, addressLine1, addressLine2, status: 'Active', price: 300000, bedrooms: 2, squareFootage: 1000, propertyType: 'Condo', mlsNumber: `M-${id}`, ...extra });
const sale = [
  listing('t1', '200 Sample Tower', 'Unit 201'),
  listing('t2', '200 Sample Tower', '#305'),
  listing('t3', '200 Sample Tower', null, { bedrooms: 3, squareFootage: 1800 }), // a record with no unit
  listing('h1', '12 N.E. Sample Avenue', null, { propertyType: 'Single Family', bedrooms: 4, squareFootage: 2200 }),
  listing('c1', '12 Sample Ct', null),
  listing('x1', '1200 Sample Tower', 'Unit 201'),
];
const rental = [listing('r1', '200 Sample Tower', 'Apt 201', { price: 2500 })];
const runs = [makeRun({ county: 'Alpha', sale, rental })];
const idsOf = (found) => found.map((c) => c.id);

test('street tokens ignore case and punctuation, and spell out the usual abbreviations the same way', () => {
  assert.deepEqual(streetTokens('1042 N.E. 3rd Avenue'), ['1042', 'ne', '3rd', 'ave']);
  assert.deepEqual(streetTokens('1042 northeast 3rd ave.'), ['1042', 'ne', '3rd', 'ave']);
  assert.deepEqual(streetTokens('7 Example Boulevard, Sampleton, FL 00000'), ['7', 'example', 'blvd', 'sampleton', 'fl', '00000']);
});

test('apt, unit, suite, # and a bare number all name the same unit; a penthouse keeps its letters', () => {
  for (const text of ['Apt 2B', 'unit 2b', '#2B', 'Suite 2-B', '2B']) assert.equal(unitKey(text), '2b');
  assert.equal(unitKey('Ph 8'), 'ph8');
  assert.equal(unitKey(null), '');
});

test('a unit is matched across spellings, and a different unit in the same building is flagged, not hidden', () => {
  const found = findCandidates(runs, { address: '200 Sample Tower', unit: 'apt 201', mode: 'sale' });
  assert.deepEqual(idsOf(found), ['t1', 't3', 't2']); // same unit, then the record with no unit, then a different unit
  assert.deepEqual(found.map((c) => c.unit), ['same', 'listing has no unit', 'different']);
});

test('the same property in the other mode is found too unless a mode is given', () => {
  assert.deepEqual(idsOf(findCandidates(runs, { address: '200 Sample Tower', unit: '201' })).slice(0, 2).sort(), ['r1', 't1']);
  assert.deepEqual(idsOf(findCandidates(runs, { address: '200 Sample Tower', unit: '201', mode: 'rental' })), ['r1']);
});

test('the house number must be the same: 200 is not 1200, and 12 Sample Ave is not 12 Sample Ct', () => {
  assert.ok(!idsOf(findCandidates(runs, { address: '200 Sample Tower' })).includes('x1'));
  assert.deepEqual(idsOf(findCandidates(runs, { address: '12 Sample Ave' })), ['h1']);
});

test('a street written differently still matches, and a missing suffix is marked partial', () => {
  const [full] = findCandidates(runs, { address: '12 northeast sample avenue' });
  assert.deepEqual([full.id, full.street], ['h1', 'exact']);
  const partial = findCandidates(runs, { address: '12 NE Sample' });
  assert.deepEqual([partial[0].id, partial[0].street], ['h1', 'partial']);
});

test('a whole address works: only the part before the first comma is the street', () => {
  assert.deepEqual(idsOf(findCandidates(runs, { address: '12 NE Sample Ave, Sampleton, FL 00000' })), ['h1']);
});

test('no unit given is said plainly, and nothing is classified for you', () => {
  const found = findCandidates(runs, { address: '12 NE Sample Ave' });
  assert.equal(found[0].unit, 'listing has no unit');
  assert.ok(!('classification' in found[0]));
});

test('beds are compared when given, and living area is shown without a verdict', () => {
  const noUnit = (query) => findCandidates(runs, { address: '200 Sample Tower', mode: 'sale', ...query }).find((c) => c.id === 't3');
  assert.equal(noUnit({ beds: 2 }).bedsMatch, false); // the record says 3 beds; the public listing says 2
  assert.equal(noUnit({ beds: 3 }).bedsMatch, true);
  assert.equal(noUnit({}).bedsMatch, null);
  const query = { address: '200 Sample Tower', unit: '9', mode: 'sale', beds: 2, sqft: 1750 };
  const text = formatCandidates(findCandidates(runs, query), query);
  assert.match(text, /living area here 1,800 vs 1,750 public/);
  assert.match(text, /Found only if beds and living area match the public listing/);
});

test('with no candidate, the output says not found under the plan\'s rule', () => {
  const none = findCandidates(runs, { address: '999 Nowhere Way' });
  assert.deepEqual(none, []);
  assert.match(formatCandidates(none, { address: '999 Nowhere Way' }), /No saved listing has that house number and street name[\s\S]*"Not found"/);
});

test('the output carries what the sheet needs for each candidate', () => {
  const query = { address: '200 Sample Tower', unit: '201', mode: 'sale' };
  const text = formatCandidates(findCandidates(runs, query), query);
  assert.match(text, /provider_id t1 {3}mls_number M-t1 {3}provider_status Active {3}provider_price \$300,000/);
  assert.match(text, /a DIFFERENT unit in this building/);
});
