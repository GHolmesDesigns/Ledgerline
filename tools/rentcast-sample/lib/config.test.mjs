import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, parseCaps, parseConfig } from './config.mjs';
import { TEST_KEY, validRawConfig } from '../test-support/helpers.mjs';

const problemsOf = (raw) => {
  try {
    parseConfig(raw);
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    return err.problems.join('\n');
  }
  return '';
};

test('a filled-in config parses, with the hard caps as defaults', () => {
  const config = parseConfig(validRawConfig());
  assert.equal(config.apiKey, TEST_KEY);
  assert.equal(config.requestCap, 40);
  assert.equal(config.rentEstimateCap, 5);
  assert.equal(config.limit, 500);
  assert.deepEqual(Object.keys(config.areas), ['alpha', 'beta']);
});

test('caps can be lowered but never raised past 40 and 5', () => {
  assert.equal(parseConfig(validRawConfig({ requestCap: 12, rentEstimateCap: 2 })).requestCap, 12);
  for (const bad of [{ requestCap: 41 }, { requestCap: 0 }, { requestCap: 2.5 }, { rentEstimateCap: 6 }]) {
    assert.match(problemsOf(validRawConfig(bad)), /must be a whole number from 1 to/);
  }
  assert.throws(() => parseCaps({ requestCap: 41 }), ConfigError);
  assert.deepEqual(parseCaps(null), { requestCap: 40, rentEstimateCap: 5 }); // usage works before the config exists
});

test('the committed example is rejected until the key and areas are filled in', () => {
  const example = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'config.example.json'), 'utf8'));
  const problems = problemsOf(example);
  assert.match(problems, /apiKey still says REPLACE_ME/);
  assert.match(problems, /areas\.miami-dade\.sale\.zipCode still says REPLACE_ME/);
  assert.match(problems, /areas\.broward\.rental\.price still says REPLACE_ME/);
});

test('a search needs a location, so a request is never spent on the whole country', () => {
  const raw = validRawConfig();
  raw.areas.alpha.sale = { price: '1:2' };
  assert.match(problemsOf(raw), /areas\.alpha\.sale needs a location/);
  raw.areas.alpha.sale = { city: 'Sampleton' }; // a city alone is ambiguous without a state
  assert.match(problemsOf(raw), /areas\.alpha\.sale needs a location/);
  raw.areas.alpha.sale = { city: 'Sampleton', state: 'FL' };
  assert.equal(problemsOf(raw), '');
  raw.areas.alpha.sale = { latitude: 1, longitude: 2, radius: 3 };
  assert.equal(problemsOf(raw), '');
});

test('parameters the script sets itself cannot be overridden', () => {
  const raw = validRawConfig();
  raw.areas.alpha.sale = { zipCode: '00000', status: 'Inactive', limit: 5, offset: 9 };
  const problems = problemsOf(raw);
  for (const key of ['status', 'limit', 'offset']) assert.match(problems, new RegExp(`areas\\.alpha\\.sale\\.${key} is set by the script`));
});

test('missing pieces are each named', () => {
  assert.match(problemsOf({}), /apiKey is missing/);
  assert.match(problemsOf({ apiKey: TEST_KEY }), /areas is empty/);
  const raw = validRawConfig();
  delete raw.areas.alpha.county;
  delete raw.areas.beta.rental;
  const problems = problemsOf(raw);
  assert.match(problems, /areas\.alpha\.county is required/);
  assert.match(problems, /areas\.beta\.rental must be an object/);
});
