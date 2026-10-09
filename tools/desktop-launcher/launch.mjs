// What the desktop shortcut runs (through launch.cmd): start the local API and web server if they
// are not already running, then open the app in the browser. See README.md in this folder.
//
// Ports: API_PORT (the same variable the API reads, default 4174) and LEDGERLINE_WEB_PORT (default
// 5173). --no-open starts and checks everything but leaves the browser alone.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT, launch } from './lib/launcher.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function port(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`${name} must be a port number from 1 to 65535, not "${raw}".`);
    process.exit(1);
  }
  return value;
}

const result = await launch({
  repoRoot,
  apiPort: port('API_PORT', DEFAULT_API_PORT),
  webPort: port('LEDGERLINE_WEB_PORT', DEFAULT_WEB_PORT),
  openBrowser: !process.argv.includes('--no-open'),
  report: (text, level) => (level === 'error' ? console.error : console.log)(text),
});
// Not process.exit(): on Windows it can abort inside libuv while the just-started servers' handles close.
process.exitCode = result.ok ? 0 : 1;
