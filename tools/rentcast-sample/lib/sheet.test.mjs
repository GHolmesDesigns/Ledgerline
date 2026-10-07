import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSV_HEADER, picksCsv } from './picks.mjs';
import { PROVIDER_TO_PUBLIC, PUBLIC_TO_PROVIDER, SheetError, loadSheets, normalizeRow, parseCsv } from './sheet.mjs';
import { withTempDir } from '../test-support/helpers.mjs';

const line = (fields) => fields.map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',');
// A record with invented values; override only what a test is about.
const record = (over = {}) => ({ county: 'Alpha', mode: 'sale', direction: PROVIDER_TO_PUBLIC, seed: '1234', address: '1 Sample Row, Sampleton, FL 00000', unit: '', provider_id: 'inv-1', mls_number: '', provider_status: 'Active', provider_price: '100000', public_status: '', public_price: '', classification: '', time_checked: '', ...over });
const csv = (records, header = CSV_HEADER) => [line(header), ...records.map((r) => line(header.map((c) => r[c] ?? '')))].join('\n') + '\n';

test('parseCsv handles quoted commas, doubled quotes, CRLF, a byte-order mark, and a missing final newline', () => {
  const text = '﻿a,b,c\r\n"1 Sample Row, Sampleton","say ""hi""",\r\nx,y,z';
  assert.deepEqual(parseCsv(text), [['a', 'b', 'c'], ['1 Sample Row, Sampleton', 'say "hi"', ''], ['x', 'y', 'z']]);
});

test('a sheet written by the picks command loads, with every row still unclassified', async () => {
  const cells = [{ county: 'Alpha', mode: 'sale', picks: [{ formattedAddress: '1 Sample Row, Sampleton, FL 00000', addressLine2: 'Apt 2', id: 'inv-1', mlsNumber: 'M1', status: 'Active', price: 100000 }] }];
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, 'picks-1.csv'), picksCsv(cells, '1'));
    const { rows } = loadSheets(dir);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].county, rows[0].mode, rows[0].direction, rows[0].seed, rows[0].classification], ['Alpha', 'sale', PROVIDER_TO_PUBLIC, '1', null]);
  });
});

test('loaded rows carry no address, unit, or provider id', () => {
  const row = normalizeRow(record({ classification: 'Available', unit: 'Apt 2' }), 2, []);
  assert.ok(!JSON.stringify(row).includes('Sample Row'));
  assert.ok(!JSON.stringify(row).includes('inv-1'));
  assert.ok(!JSON.stringify(row).includes('Apt 2'));
});

test('classifications are case-insensitive and checked against the direction', () => {
  const problems = [];
  assert.equal(normalizeRow(record({ classification: ' NOT FOUND ' }), 2, problems).classification, 'not found');
  assert.equal(normalizeRow(record({ direction: PUBLIC_TO_PROVIDER, classification: 'Found', public_status: 'Active', provider_status: 'Active', public_price: '$1,000', provider_price: '1000' }), 3, problems).classification, 'found');
  assert.deepEqual(problems, []);
  normalizeRow(record({ classification: 'Found' }), 4, problems); // "found" is not a still-available word
  assert.match(problems[0], /row 4: classification "Found" is not one of: available, not available, not found, ambiguous/);
});

test('buy and rent are accepted for sale and rental', () => {
  assert.equal(normalizeRow(record({ mode: 'Buy' }), 2, []).mode, 'sale');
  assert.equal(normalizeRow(record({ mode: 'Rent' }), 2, []).mode, 'rental');
});

test('a found listing needs a recognised status and a price on both sides, and prices lose $ and commas', () => {
  const found = record({ direction: PUBLIC_TO_PROVIDER, classification: 'found', public_status: 'Pending', provider_status: 'active', public_price: '$1,250,000', provider_price: '1250000.50' });
  const problems = [];
  const row = normalizeRow(found, 2, problems);
  assert.deepEqual(problems, []);
  assert.deepEqual([row.publicGroup, row.providerGroup, row.publicPrice, row.providerPrice], ['Under contract', 'Active', 1250000, 1250000.5]);

  const bad = [];
  normalizeRow({ ...found, public_status: 'Inactive', provider_price: '' }, 3, bad);
  assert.equal(bad.length, 2);
  assert.match(bad[0], /row 3: public_status "Inactive" is not one of the plan's words/);
  assert.match(bad[1], /row 3: provider_price is missing/);
});

test('a bad sheet is reported by row number and column, never by address, and nothing is scored', async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, 'picks-9.csv'), csv([record(), record({ classification: 'Maybe', address: '99 Secret Row, Sampleton, FL 00000' }), record({ direction: 'sideways' })]));
    assert.throws(() => loadSheets(dir), (err) => {
      assert.ok(err instanceof SheetError);
      assert.match(err.message, /row 3: classification "Maybe"/);
      assert.match(err.message, /row 4: direction "sideways"/);
      assert.ok(!err.message.includes('Secret Row'));
      return true;
    });
  });
});

test('blank lines at the end of a sheet are ignored, and a sheet missing a column is named', async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, 'a.csv'), csv([record()]) + ',,,,,,,,,,,,,\n\n');
    assert.equal(loadSheets(dir).rows.length, 1);
    writeFileSync(join(dir, 'b.csv'), csv([record()], CSV_HEADER.filter((c) => c !== 'classification')));
    assert.throws(() => loadSheets(dir), /b\.csv: missing column classification/);
  });
});

test('sheets are read together, and --sheet names exactly which ones', async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, 'picks-1.csv'), csv([record({ seed: '1' })]));
    writeFileSync(join(dir, 'coverage.csv'), csv([record({ direction: PUBLIC_TO_PROVIDER, seed: '2' })]));
    assert.equal(loadSheets(dir).rows.length, 2);
    const only = loadSheets(dir, [join(dir, 'coverage.csv')]);
    assert.deepEqual(only.rows.map((r) => r.direction), [PUBLIC_TO_PROVIDER]);
  });
});

test('no sheets at all is an empty result, not an error', async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(loadSheets(join(dir, 'does-not-exist')).rows, []);
  });
});
