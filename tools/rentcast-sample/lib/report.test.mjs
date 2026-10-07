import test from 'node:test';
import assert from 'node:assert/strict';
import { coverage, formatReport, formatShare } from './report.mjs';
import { invented, makeRun } from '../test-support/helpers.mjs';

const byMode = (rows, mode) => rows.find((r) => r.mode === mode);

test('sale coverage counts only active listings, with every measure', () => {
  const sale = byMode(coverage(makeRun({ sale: invented.sale, rental: invented.rental })), 'sale');
  assert.equal(sale.returned, 8);
  assert.equal(sale.active, 7); // inv-s7 is Inactive and is left out of every share
  assert.deepEqual(sale.hoaFee, { n: 4, of: 7 }); // a fee of 0 (inv-s8) counts as supplied
  assert.deepEqual(sale.mlsNumber, { n: 5, of: 7 });
  assert.deepEqual(sale.contact, { n: 4, of: 7 }); // a name alone (inv-s3) is not a contact
  assert.deepEqual(sale.mlsOrContact, { n: 6, of: 7 }); // only inv-s6 has neither
  assert.deepEqual(sale.history, { n: 5, of: 7 }); // an empty history object (inv-s3) doesn't count
  assert.deepEqual(sale.seenWithin7Days, { n: 5, of: 7 }); // inv-s8 is exactly 7 days old; inv-s6 has no date
});

test('share of condo and townhome sale listings with no HOA fee', () => {
  const sale = byMode(coverage(makeRun({ sale: invented.sale })), 'sale');
  // Active condos and townhomes: inv-s2, s3, s4, s5. Without a fee: s3 and s4.
  assert.deepEqual(sale.condoTownhomeNoHoa, { n: 2, of: 4 });
});

test('rental coverage uses the same measures and skips the condo and townhome one', () => {
  const rental = byMode(coverage(makeRun({ rental: invented.rental })), 'rental');
  assert.equal(rental.active, 3);
  assert.deepEqual(rental.hoaFee, { n: 1, of: 3 });
  assert.deepEqual(rental.mlsNumber, { n: 2, of: 3 });
  assert.deepEqual(rental.contact, { n: 1, of: 3 });
  assert.deepEqual(rental.history, { n: 2, of: 3 });
  assert.deepEqual(rental.seenWithin7Days, { n: 2, of: 3 });
  assert.equal(rental.condoTownhomeNoHoa, null);
});

test('"last seen within 7 days" is measured from the pull, and the 7-day edge is inclusive', () => {
  const listing = (id, lastSeenDate) => ({ id, status: 'Active', lastSeenDate });
  const run = makeRun({
    fetchedAt: '2026-10-07T12:00:00.000Z',
    sale: [listing('on-edge', '2026-09-30T12:00:00.000Z'), listing('a-minute-over', '2026-09-30T11:59:00.000Z'), listing('not-a-date', 'soon')],
  });
  assert.deepEqual(byMode(coverage(run), 'sale').seenWithin7Days, { n: 1, of: 3 });
});

test('an empty search reports 0/0 instead of dividing by zero', () => {
  const sale = byMode(coverage(makeRun()), 'sale');
  assert.deepEqual(sale.hoaFee, { n: 0, of: 0 });
  assert.equal(formatShare(sale.hoaFee), '0/0 (no listings)');
  assert.equal(formatShare({ n: 4, of: 7 }), '4/7 (57.1%)');
});

test('the report shows every measure for every county and mode', () => {
  const text = formatReport([
    makeRun({ area: 'alpha', county: 'Alpha', sale: invented.sale, rental: invented.rental }),
    makeRun({ area: 'beta', county: 'Beta', sale: invented.sale, rental: invented.rental }),
  ]);
  for (const county of ['Alpha', 'Beta']) {
    for (const mode of ['sale', 'rental']) assert.match(text, new RegExp(`${county} · ${mode} · run `));
  }
  const measures = ['Requests for this search', 'Listings returned / active', 'With an HOA fee', 'With an MLS number:', 'With an agent or office contact', 'With history', 'Last seen within 7 days of the pull', 'Condo and townhome sale listings with no HOA fee'];
  for (const measure of measures) assert.equal(text.split(measure).length - 1, 4, `${measure} appears once per county and mode`);
  assert.match(text, /Condo and townhome sale listings with no HOA fee: 2\/4 \(50\.0%\)/);
  assert.match(text, /Condo and townhome sale listings with no HOA fee: not measured for rentals/);
});

test('an incomplete search is flagged with its reason', () => {
  const text = formatReport([makeRun({ sale: invented.sale, complete: false })]);
  assert.match(text, /INCOMPLETE/);
  assert.match(text, /WARNING: Stopped before sending: cap\./);
});
