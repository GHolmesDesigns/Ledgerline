// Starts the local API and web server if they are not already up, then opens the app.
// It only starts: the servers keep running after the browser closes and there is no stop
// (plan 2.13). Everything stays on 127.0.0.1, and nothing here reads or writes a credential.
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export const HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 4174;
export const DEFAULT_WEB_PORT = 5173;

const PROBE_TIMEOUT_MS = 2000;
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const LOG_TAIL_LINES = 12;

/** The two servers the app needs, with how to recognise each one and how to start it. */
export function serverSpecs({ apiPort, webPort }) {
  return [
    {
      key: 'api',
      label: 'API server',
      port: apiPort,
      url: `http://${HOST}:${apiPort}/api/health`,
      expected: 'the Ledgerline API',
      identify: async (response) => {
        try {
          return response.ok && (await response.json()).status === 'ok';
        } catch {
          return false;
        }
      },
      command: 'npm run dev --workspace @ledgerline/api',
    },
    {
      key: 'web',
      label: 'web server',
      port: webPort,
      url: `http://${HOST}:${webPort}/`,
      expected: 'the Ledgerline web app',
      identify: async (response) => response.ok && (await response.text()).includes('id="root"'),
      command: `npm run dev --workspace @ledgerline/web -- --port ${webPort} --strictPort`,
    },
  ];
}

function tcpAccepts(port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: HOST });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * What is on a port: 'running' (it answers as the expected Ledgerline server), 'free' (nothing is
 * listening), or 'busy' (something else is, including something that accepts and never answers).
 */
export async function probe(spec, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(timeoutMs) });
    return (await spec.identify(response)) ? 'running' : 'busy';
  } catch {
    return (await tcpAccepts(spec.port, timeoutMs)) ? 'busy' : 'free';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tailOf(logFile, lines = LOG_TAIL_LINES) {
  try {
    const text = readFileSync(logFile, 'utf8').trimEnd();
    return text ? text.split(/\r?\n/).slice(-lines).join('\n') : '';
  } catch {
    return '';
  }
}

/** Start one server detached from this process, writing its output to a log file. */
export function startServerProcess(spec, { cwd, logFile }) {
  mkdirSync(join(logFile, '..'), { recursive: true });
  const log = openSync(logFile, 'w');
  const child = spawn(spec.command, {
    cwd,
    shell: true,
    // Not `detached`: on Windows that starts the servers with no console at all, and two npm
    // processes started together then fail intermittently (exit code 0xC0000142). `windowsHide`
    // gives each its own hidden console, so they still outlive this launcher and its window.
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  const exited = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, error: error.message }));
    child.once('exit', (code) => resolve({ code }));
  });
  child.unref();
  return { exited };
}

/** Open a URL in the default browser. Only Windows is supported (plan: launcher is Windows first). */
export function openInBrowser(url) {
  if (process.platform !== 'win32') {
    throw new Error(`Automatic opening is Windows-only. Open ${url} yourself.`);
  }
  spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/**
 * Bring the app up and open it. Returns { ok, messages } and never throws for an expected problem:
 * a port taken by another program, a server that exits, or one that does not answer in time.
 */
export async function launch({
  apiPort = DEFAULT_API_PORT,
  webPort = DEFAULT_WEB_PORT,
  repoRoot,
  logDirectory = join(repoRoot ?? '.', 'data', 'launcher'),
  startServer = (spec) =>
    startServerProcess(spec, { cwd: repoRoot, logFile: join(logDirectory, `${spec.key}.log`) }),
  open = openInBrowser,
  openBrowser = true,
  report = () => {},
  readyTimeoutMs = READY_TIMEOUT_MS,
  pollIntervalMs = POLL_INTERVAL_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const specs = serverSpecs({ apiPort, webPort });
  const messages = [];
  const say = (text, level = 'info') => {
    messages.push(text);
    report(text, level);
  };
  const appUrl = `http://${HOST}:${webPort}`;

  const states = await Promise.all(specs.map((spec) => probe(spec, probeTimeoutMs)));
  const problems = specs
    .filter((_, index) => states[index] === 'busy')
    .map(
      (spec) =>
        `Port ${spec.port} is already in use by another program, so the Ledgerline ${spec.label} cannot use it ` +
        `(it did not answer as ${spec.expected}). Close that program and try again.`,
    );
  if (problems.length > 0) {
    problems.forEach((text) => say(text, 'error'));
    return { ok: false, messages, started: [] };
  }

  const toStart = specs.filter((_, index) => states[index] === 'free');
  if (toStart.length === 0) {
    say('Ledgerline is already running.');
  } else {
    say(`Starting the Ledgerline ${toStart.map((spec) => spec.label).join(' and ')}...`);
  }

  const runs = await Promise.all(
    toStart.map(async (spec) => ({ spec, process: await startServer(spec) })),
  );
  const failures = await Promise.all(
    runs.map(async ({ spec, process }) => {
      const deadline = Date.now() + readyTimeoutMs;
      let exit;
      process.exited.then((result) => {
        exit = result;
      });
      while (Date.now() < deadline) {
        if ((await probe(spec, probeTimeoutMs)) === 'running') return undefined;
        await sleep(pollIntervalMs);
        if (exit) break;
      }
      const detail = exit
        ? exit.error
          ? `could not be started: ${exit.error}`
          : `stopped with exit code ${exit.code}`
        : `did not answer on port ${spec.port} within ${Math.round(readyTimeoutMs / 1000)} seconds`;
      const tail = tailOf(join(logDirectory, `${spec.key}.log`));
      return (
        `The Ledgerline ${spec.label} ${detail}.` +
        (tail ? `\nLast output (data/launcher/${spec.key}.log):\n${tail}` : '')
      );
    }),
  );
  const failed = failures.filter(Boolean);
  if (failed.length > 0) {
    failed.forEach((text) => say(text, 'error'));
    const running = toStart.filter((_, index) => !failures[index]).map((spec) => spec.label);
    if (running.length > 0) {
      say(`The ${running.join(' and ')} did start and is left running.`, 'error');
    }
    return { ok: false, messages, started: toStart.map((spec) => spec.key) };
  }

  if (openBrowser) {
    say(`Opening ${appUrl}`);
    try {
      open(appUrl);
    } catch (error) {
      say(error.message, 'error');
      return { ok: false, messages, started: toStart.map((spec) => spec.key) };
    }
  } else {
    say(`Ready at ${appUrl}`);
  }
  return { ok: true, messages, started: toStart.map((spec) => spec.key) };
}
