import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { assertCredentialAbsent } from './check-client-secrets.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('production bundle credential scan', () => {
  it('fails when the configured server credential appears in a web asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ledgerline-bundle-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'index.js'), 'const token = "fake-rentcast-secret";');
    await assert.rejects(
      assertCredentialAbsent(directory, 'fake-rentcast-secret'),
      /server-only RentCast credential/,
    );
  });

  it('allows a credential that does not appear in the bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ledgerline-bundle-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'index.js'), 'const provider = "mock";');
    await assertCredentialAbsent(directory, 'local-secret');
  });
});
