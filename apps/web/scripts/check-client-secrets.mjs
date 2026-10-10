import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : path;
    }),
  );
  return paths.flat();
}

export async function assertCredentialAbsent(bundleDirectory, credential, label = 'RentCast') {
  if (!credential) return;
  for (const filePath of await filesUnder(bundleDirectory)) {
    const content = await readFile(filePath, 'utf8');
    if (content.includes(credential)) {
      throw new Error(`Production web bundle contains the server-only ${label} credential.`);
    }
  }
}

function configuredKey(contents, name) {
  const line = contents.split(/\r?\n/).find((entry) => entry.split('=')[0]?.trim() === name);
  if (!line) return '';
  const value = line.slice(line.indexOf('=') + 1).trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return '';
    }
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const apiConfig = resolve(process.cwd(), '../api/.env');
  const bundle = resolve(process.cwd(), 'dist');
  try {
    const config = await readFile(apiConfig, 'utf8');
    await assertCredentialAbsent(bundle, configuredKey(config, 'RENTCAST_API_KEY'));
    await assertCredentialAbsent(
      bundle,
      configuredKey(config, 'GOOGLE_MAPS_API_KEY'),
      'Google Maps',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
