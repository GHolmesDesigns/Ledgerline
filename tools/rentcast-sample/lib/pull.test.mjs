import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './client.mjs';
import { parseConfig } from './config.mjs';
import { queryFromListing, runEstimate } from './estimate.mjs';
import { pullArea } from './pull.mjs';
import { CapError, readUsage, summarize } from './usage.mjs';
import { TEST_KEY, fakeFetch, invented, testPaths, validRawConfig, withTempDir } from '../test-support/helpers.mjs';

const NOW = () => new Date('2026-10-07T12:00:00.000Z');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// Runs `fn` with a config, paths, and a client wired to a fake network.
async function setup(fn, { fetchOptions, config: overrides } = {}) {
  return withTempDir(async (dir) => {
    const config = parseConfig(validRawConfig(overrides));
    const fetchImpl = fakeFetch(fetchOptions);
    const client = createClient({ apiKey: config.apiKey, fetchImpl });
    return fn({ dir, config, fetchImpl, client, paths: testPaths(dir) });
  });
}
const pull = (ctx, areaKey = 'alpha') => pullArea({ areaKey, area: ctx.config.areas[areaKey], config: ctx.config, client: ctx.client, paths: ctx.paths, now: NOW });

test('one run saves the raw sale and rental responses and counts its requests', () => setup(async (ctx) => {
  const result = await pull(ctx);
  assert.equal(result.stopped, null);
  assert.equal(result.requestsThisRun, 2);
  assert.deepEqual(readJson(join(result.runDir, 'sale-page1.json')), invented.sale);
  assert.deepEqual(readJson(join(result.runDir, 'rental-page1.json')), invented.rental);

  const manifest = readJson(join(result.runDir, 'manifest.json'));
  assert.equal(manifest.county, 'Alpha');
  assert.deepEqual(manifest.searches.map((s) => [s.mode, s.requests, s.complete]), [['sale', 1, true], ['rental', 1, true]]);
  assert.equal(summarize(readUsage(ctx.paths.usage)).total, 2);
  assert.deepEqual(ctx.fetchImpl.calls.map((c) => c.path), ['/v1/listings/sale', '/v1/listings/rental/long-term']);
  assert.deepEqual(ctx.fetchImpl.calls[0].params, { zipCode: '00000', price: '1:2', status: 'Active', limit: '500', offset: '0' });
}));

test('a full page triggers another request, so requests per search are measured', () => setup(async (ctx) => {
  const result = await pull(ctx);
  const manifest = readJson(join(result.runDir, 'manifest.json'));
  // 8 sale listings at 3 per page: pages of 3, 3, 2. 3 rental listings: a full page of 3, then an empty one.
  assert.deepEqual(manifest.searches.map((s) => [s.mode, s.requests, s.pages.map((p) => p.count)]), [['sale', 3, [3, 3, 2]], ['rental', 2, [3, 0]]]);
  assert.deepEqual(ctx.fetchImpl.calls.filter((c) => c.path.endsWith('/sale')).map((c) => c.params.offset), ['0', '3', '6']);
  assert.equal(result.requestsThisRun, 5);
}, { config: { limit: 3 } }));

test('a run that would pass the cap stops before sending, and says why', () => setup(async (ctx) => {
  mkdirSync(ctx.dir, { recursive: true });
  writeFileSync(ctx.paths.usage, JSON.stringify({ requests: Array.from({ length: 40 }, (_, i) => ({ n: i + 1, kind: 'sale', status: 200 })) }));
  const result = await pull(ctx);
  assert.equal(ctx.fetchImpl.calls.length, 0); // nothing was sent
  assert.equal(result.stopped.type, 'cap');
  assert.match(result.stopped.message, /40 of 40 requests are already used/);
  assert.equal(result.requestsThisRun, 0);
  assert.equal(existsSync(ctx.paths.raw), false); // and no empty run folder was left behind
  assert.equal(summarize(readUsage(ctx.paths.usage)).total, 40);
}));

test('the cap counts across runs and stops mid-run, keeping what was fetched', () => setup(async (ctx) => {
  const first = await pull(ctx, 'alpha'); // 2 requests
  assert.equal(first.stopped, null);
  const second = await pull(ctx, 'beta'); // cap is 3: the sale search goes, the rental search is blocked
  assert.equal(second.requestsThisRun, 1);
  assert.equal(second.stopped.type, 'cap');
  assert.equal(ctx.fetchImpl.calls.length, 3); // the blocked request was never sent
  assert.equal(summarize(readUsage(ctx.paths.usage)).total, 3);

  const manifest = readJson(join(second.runDir, 'manifest.json'));
  assert.deepEqual(manifest.searches.map((s) => [s.mode, s.complete]), [['sale', true], ['rental', false]]);
  assert.match(manifest.searches[1].stoppedReason, /Nothing was sent/);
  assert.equal(existsSync(join(second.runDir, 'rental-page1.json')), false);
}, { config: { requestCap: 3 } }));

test('an HTTP error is counted, saved nowhere, and ends the run', () => setup(async (ctx) => {
  const result = await pull(ctx);
  assert.equal(result.stopped.type, 'http');
  assert.equal(result.stopped.message, 'HTTP 401: Invalid API key');
  assert.equal(ctx.fetchImpl.calls.length, 1); // no further requests after a failure, and no retry
  assert.deepEqual(readUsage(ctx.paths.usage).requests.map((r) => r.status), [401]);
  assert.deepEqual(readdirSync(result.runDir), ['manifest.json']);
}, { fetchOptions: { fail: { status: 401, body: { message: 'Invalid API key' } } } }));

test('a request with no response still counts against the cap', () => setup(async (ctx) => {
  const result = await pull(ctx);
  assert.equal(result.stopped.type, 'network');
  assert.deepEqual(readUsage(ctx.paths.usage).requests.map((r) => r.status), [null]);
  assert.equal(summarize(readUsage(ctx.paths.usage)).total, 1);
}, { fetchOptions: { noResponse: true } }));

test('the API key goes in a header and is never written to disk or put in a URL', () => setup(async (ctx) => {
  await pull(ctx);
  await runEstimate({ query: { address: '1 Sample Row, Sampleton, FL 00000' }, config: ctx.config, client: ctx.client, paths: ctx.paths, now: NOW });
  for (const call of ctx.fetchImpl.calls) {
    assert.equal(call.headers['X-Api-Key'], TEST_KEY);
    assert.ok(!call.url.includes(TEST_KEY));
  }
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  const files = walk(ctx.dir);
  assert.ok(files.length >= 4);
  for (const file of files) assert.ok(!readFileSync(file, 'utf8').includes(TEST_KEY), `${file} must not contain the key`);
}));

test('rent estimates count toward the same cap, with at most 5', () => setup(async (ctx) => {
  const estimate = () => runEstimate({ query: { address: '1 Sample Row, Sampleton, FL 00000' }, config: ctx.config, client: ctx.client, paths: ctx.paths, now: NOW });
  for (let i = 0; i < 5; i++) await estimate();
  await assert.rejects(estimate, CapError);
  assert.equal(ctx.fetchImpl.calls.length, 5); // the sixth was refused before sending
  assert.deepEqual(summarize(readUsage(ctx.paths.usage)), { total: 5, estimates: 5 });
  assert.equal(readdirSync(ctx.paths.estimates).length, 5);
}));

test('an estimate that would pass the 40-request cap is refused', () => setup(async (ctx) => {
  const result = await runEstimate({ query: { address: 'x' }, config: ctx.config, client: ctx.client, paths: ctx.paths, now: NOW });
  assert.equal(result.response.rent, 2500);
  await assert.rejects(() => runEstimate({ query: { address: 'x' }, config: ctx.config, client: ctx.client, paths: ctx.paths, now: NOW }), /Nothing was sent/);
}, { config: { requestCap: 1 } }));

test('an estimate query is built from a saved listing', () => {
  assert.deepEqual(queryFromListing(invented.sale[1]), { address: '200 Sample Tower, Unit 201, Sampleton, FL 00000', propertyType: 'Condo', bedrooms: 2, bathrooms: 2, squareFootage: 1000 });
  assert.deepEqual(queryFromListing({ formattedAddress: 'x', bedrooms: null }), { address: 'x' });
});
