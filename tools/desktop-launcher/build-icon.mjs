// Rebuilds design/brand/ledgerline.ico from the brand PNGs: `npm run launcher:icon`.
// Optional: --brand <folder> (default design/brand) and --out <file> (default <brand>/ledgerline.ico).
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcon } from './lib/icon.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const brandDir = resolve(option('--brand') ?? join(repoRoot, 'design/brand'));
const output = resolve(option('--out') ?? join(brandDir, 'ledgerline.ico'));

try {
  const ico = buildIcon(brandDir);
  writeFileSync(output, ico);
  console.log(`Wrote ${output} (${ico.length} bytes).`);
} catch (error) {
  console.error(`Could not build the icon: ${error.message}`);
  process.exitCode = 1;
}
