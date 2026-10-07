import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CapError, describeUsage, readUsage, reserve, settle, summarize } from './usage.mjs';
import { withTempDir } from '../test-support/helpers.mjs';

const caps = { requestCap: 40, rentEstimateCap: 5 };
const fill = (path, count, kind = 'sale') => writeFileSync(path, JSON.stringify({ requests: Array.from({ length: count }, (_, i) => ({ n: i + 1, kind, status: 200 })) }));

test('a request is counted before it is sent, then given its status', () => withTempDir((dir) => {
  const path = join(dir, 'usage.json');
  const n = reserve(path, { kind: 'sale', note: 'alpha sale page 1' }, caps);
  assert.equal(n, 1);
  assert.equal(readUsage(path).requests[0].status, null); // sent, no answer yet: still counts
  assert.equal(summarize(readUsage(path)).total, 1);
  settle(path, n, 200);
  assert.equal(readUsage(path).requests[0].status, 200);
}));

test('the count carries across runs: request 41 is refused and nothing is written', () => withTempDir((dir) => {
  const path = join(dir, 'usage.json');
  fill(path, 40);
  const before = readFileSync(path, 'utf8');
  assert.throws(() => reserve(path, { kind: 'sale', note: 'x' }, caps), (err) => err instanceof CapError && /40 of 40 requests are already used/.test(err.message) && /Nothing was sent/.test(err.message));
  assert.equal(readFileSync(path, 'utf8'), before);
}));

test('a lower cap is honored', () => withTempDir((dir) => {
  const path = join(dir, 'usage.json');
  const low = { requestCap: 2, rentEstimateCap: 5 };
  reserve(path, { kind: 'sale', note: 'a' }, low);
  reserve(path, { kind: 'rental', note: 'b' }, low);
  assert.throws(() => reserve(path, { kind: 'sale', note: 'c' }, low), CapError);
  assert.equal(summarize(readUsage(path)).total, 2);
}));

test('rent estimates stop at 5 even when the 40 are not used', () => withTempDir((dir) => {
  const path = join(dir, 'usage.json');
  for (let i = 0; i < 5; i++) reserve(path, { kind: 'rent-estimate', note: 'e' }, caps);
  assert.throws(() => reserve(path, { kind: 'rent-estimate', note: 'e' }, caps), (err) => err instanceof CapError && /5 of 5 rent-estimate calls/.test(err.message));
  assert.doesNotThrow(() => reserve(path, { kind: 'sale', note: 's' }, caps)); // searches still have room
  assert.deepEqual(summarize(readUsage(path)), { total: 6, estimates: 5 });
}));

test('a damaged usage file is an error, never a reset to zero', () => withTempDir((dir) => {
  const path = join(dir, 'usage.json');
  writeFileSync(path, '{ not json');
  assert.throws(() => reserve(path, { kind: 'sale', note: 'x' }, caps), /unreadable/);
  assert.equal(readFileSync(path, 'utf8'), '{ not json');
}));

test('describeUsage reports requests used against the cap', () => withTempDir((dir) => {
  const path = join(dir, 'usage.json');
  assert.equal(describeUsage(path, caps), 'Requests used: 0 of 40. Rent estimates: 0 of 5.');
  reserve(path, { kind: 'sale', note: 'a' }, caps);
  reserve(path, { kind: 'rent-estimate', note: 'e' }, caps);
  assert.equal(describeUsage(path, caps), 'Requests used: 2 of 40. Rent estimates: 1 of 5.');
}));
