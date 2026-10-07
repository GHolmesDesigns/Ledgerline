// "Nothing returned by RentCast is committed" depends on these paths staying git-ignored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const git = spawnSync('git', ['--version'], { cwd: root });
const gitMissing = git.error || git.status !== 0 ? 'git is not available' : false;

const PATHS = [
  'tools/rentcast-sample/config.local.json', // the API key
  'tools/rentcast-sample/local/usage.json',
  'tools/rentcast-sample/local/raw/20261007T120000Z-alpha/sale-page1.json', // raw responses
  'tools/rentcast-sample/local/raw/20261007T120000Z-alpha/manifest.json',
  'tools/rentcast-sample/local/estimates/20261007T120000Z-request1.json',
  'tools/rentcast-sample/local/picks/picks-12345678.csv', // real addresses
];

test('the key, raw responses, usage file, estimates, and picks are git-ignored', { skip: gitMissing }, () => {
  for (const path of PATHS) {
    const result = spawnSync('git', ['check-ignore', '--quiet', path], { cwd: root });
    assert.equal(result.status, 0, `${path} must be git-ignored`);
  }
});

test('the example config is not ignored, so it can be committed', { skip: gitMissing }, () => {
  const result = spawnSync('git', ['check-ignore', '--quiet', 'tools/rentcast-sample/config.example.json'], { cwd: root });
  assert.equal(result.status, 1);
});
