import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launch } from './launcher.mjs';

const run = promisify(execFile);
const launchScript = resolve(dirname(fileURLToPath(import.meta.url)), '../launch.mjs');

const API_BODY = JSON.stringify({ status: 'ok' });
const WEB_BODY = '<!doctype html><html><body><div id="root"></div></body></html>';

function listen(server, port = 0) {
  return new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
}

/** A real listener on a free port that answers like the Ledgerline API or web app. */
function fakeServer(kind) {
  const server = http.createServer((request, response) => {
    if (kind === 'api') {
      response.setHeader('content-type', 'application/json');
      response.end(API_BODY);
    } else if (kind === 'web') {
      response.setHeader('content-type', 'text/html');
      response.end(WEB_BODY);
    } else {
      response.statusCode = 404;
      response.end('some other program');
    }
  });
  return server;
}

async function freePort() {
  const server = net.createServer();
  await listen(server);
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

describe('desktop launcher', () => {
  let open;
  let opened;
  let started;
  let listeners;
  let sockets;
  let logDirectory;
  let apiPort;
  let webPort;

  beforeEach(async () => {
    opened = [];
    started = [];
    listeners = [];
    sockets = [];
    open = (url) => opened.push(url);
    logDirectory = mkdtempSync(join(tmpdir(), 'ledgerline-launcher-'));
    apiPort = await freePort();
    webPort = await freePort();
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    await Promise.all(
      listeners.map((server) => {
        server.closeAllConnections?.();
        return new Promise((done) => server.close(done));
      }),
    );
    rmSync(logDirectory, { recursive: true, force: true });
  });

  async function serve(kind, port) {
    const server = fakeServer(kind);
    listeners.push(server);
    await listen(server, port);
  }

  /** A stand-in for starting the real servers: it brings up a fake one on the spec's port. */
  function fakeStart(behaviour = {}) {
    return async (spec) => {
      started.push(spec.key);
      const how = behaviour[spec.key] ?? 'ok';
      if (how === 'ok') {
        await serve(spec.key, spec.port);
        return { exited: new Promise(() => {}) };
      }
      writeFileSync(
        join(logDirectory, `${spec.key}.log`),
        'first line\nError: listen EADDRINUSE\n',
      );
      return { exited: Promise.resolve({ code: 1 }) };
    };
  }

  const options = () => ({
    apiPort,
    webPort,
    logDirectory,
    open,
    readyTimeoutMs: 3000,
    pollIntervalMs: 20,
    probeTimeoutMs: 300,
  });

  // The card's "second run only opens the browser": a second launcher must never start a second pair.
  it('only opens the browser when both servers are already running, starting nothing', async () => {
    await serve('api', apiPort);
    await serve('web', webPort);
    const result = await launch({ ...options(), startServer: fakeStart() });
    assert.equal(result.ok, true);
    assert.deepEqual(started, []);
    assert.deepEqual(opened, [`http://127.0.0.1:${webPort}`]);
  });

  // The first run: stopped servers are started, and the browser opens only once both answer.
  it('starts both servers when neither is running, then opens the app once', async () => {
    const result = await launch({ ...options(), startServer: fakeStart() });
    assert.equal(result.ok, true);
    assert.deepEqual(started.sort(), ['api', 'web']);
    assert.deepEqual(opened, [`http://127.0.0.1:${webPort}`]);
  });

  // Starting a second copy of a server that is up would hit its port and fail the whole launch.
  it('starts only the server that is missing', async () => {
    await serve('api', apiPort);
    const result = await launch({ ...options(), startServer: fakeStart() });
    assert.equal(result.ok, true);
    assert.deepEqual(started, ['web']);
    assert.equal(opened.length, 1);
  });

  // The card's port-in-use case: name the port and the server, and touch nothing.
  it('names the port and server when another program holds a port, and starts and opens nothing', async () => {
    await serve('api', apiPort);
    await serve('other', webPort);
    const result = await launch({ ...options(), startServer: fakeStart() });
    assert.equal(result.ok, false);
    assert.match(
      result.messages.join('\n'),
      new RegExp(`Port ${webPort} is already in use.*web server`),
    );
    assert.doesNotMatch(result.messages.join('\n'), new RegExp(`Port ${apiPort}`));
    assert.deepEqual(started, []);
    assert.deepEqual(opened, []);
  });

  // A program that accepts connections and never answers HTTP still occupies the port.
  it('treats a port that accepts connections but never answers as in use', async () => {
    const silent = net.createServer((socket) => sockets.push(socket));
    listeners.push(silent);
    await listen(silent, apiPort);
    const result = await launch({ ...options(), startServer: fakeStart() });
    assert.equal(result.ok, false);
    assert.match(result.messages[0], new RegExp(`Port ${apiPort} is already in use.*API server`));
    assert.deepEqual(started, []);
  });

  // The server that stops itself is named, with what it printed, and the browser is left closed.
  it('reports which server failed to start, with its last output, and does not open the browser', async () => {
    const result = await launch({ ...options(), startServer: fakeStart({ web: 'exit' }) });
    assert.equal(result.ok, false);
    const text = result.messages.join('\n');
    assert.match(text, /web server stopped with exit code 1/);
    assert.match(text, /EADDRINUSE/);
    assert.match(text, /API server did start and is left running/);
    assert.deepEqual(opened, []);
  });

  it('reports a server that never answers, naming its port', async () => {
    const result = await launch({
      ...options(),
      readyTimeoutMs: 200,
      startServer: async (spec) => {
        started.push(spec.key);
        return { exited: new Promise(() => {}) };
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.messages.join('\n'), new RegExp(`did not answer on port ${apiPort}`));
    assert.deepEqual(opened, []);
  });

  describe('the command the shortcut runs', () => {
    const env = (extra) => ({ ...process.env, ...extra });

    it('exits 0 and starts nothing when the app is already up (--no-open)', async () => {
      await serve('api', apiPort);
      await serve('web', webPort);
      const { stdout } = await run(process.execPath, [launchScript, '--no-open'], {
        env: env({ API_PORT: String(apiPort), LEDGERLINE_WEB_PORT: String(webPort) }),
      });
      assert.match(stdout, /already running/);
      assert.match(stdout, new RegExp(`Ready at http://127.0.0.1:${webPort}`));
    });

    it('exits 1 with a message naming the port when another program holds it', async () => {
      await serve('api', apiPort);
      await serve('other', webPort);
      await assert.rejects(
        run(process.execPath, [launchScript, '--no-open'], {
          env: env({ API_PORT: String(apiPort), LEDGERLINE_WEB_PORT: String(webPort) }),
        }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, new RegExp(`Port ${webPort} is already in use`));
          return true;
        },
      );
    });

    it('refuses a port setting that is not a port number', async () => {
      await assert.rejects(
        run(process.execPath, [launchScript, '--no-open'], { env: env({ API_PORT: 'abc' }) }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, /API_PORT must be a port number/);
          return true;
        },
      );
    });
  });
});
