// One run = one area (county): the sale search, then the rental search, each paged until a short page.
// Raw responses are saved exactly as received, under the git-ignored local folder.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODES } from './config.mjs';
import { errorMessage } from './client.mjs';
import { CapError, describeUsage, reserve, settle } from './usage.mjs';

// 20261007T143012Z: sorts in time order and is safe in a Windows folder name.
export const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export async function pullArea({ areaKey, area, config, client, paths, now = () => new Date(), log = () => {} }) {
  const caps = { requestCap: config.requestCap, rentEstimateCap: config.rentEstimateCap };
  const startedAt = now();
  const runId = `${stamp(startedAt)}-${areaKey}`;
  const runDir = join(paths.raw, runId);
  if (existsSync(runDir)) throw new Error(`${runDir} already exists. Wait a second and rerun, so the earlier pull isn't overwritten.`);
  const manifest = { runId, area: areaKey, county: area.county, startedAt: startedAt.toISOString(), limit: config.limit, searches: [] };
  let requestsThisRun = 0;
  let stopped = null;

  const save = () => {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  };
  const stop = (search, type, message) => {
    stopped = { type, message };
    search.stoppedReason = message;
    if (requestsThisRun > 0) save();
  };

  for (const mode of MODES) {
    const search = { mode, params: area[mode], fetchedAt: null, requests: 0, pages: [], complete: false, stoppedReason: null };
    manifest.searches.push(search);

    for (let page = 1; ; page++) {
      let n;
      try {
        n = reserve(paths.usage, { kind: mode, note: `${areaKey} ${mode} page ${page}` }, caps, now());
      } catch (err) {
        if (!(err instanceof CapError)) throw err;
        stop(search, 'cap', err.message);
        return { runId, runDir: requestsThisRun > 0 ? runDir : null, requestsThisRun, stopped };
      }
      requestsThisRun++;
      search.requests++;
      search.fetchedAt ??= now().toISOString();

      let res;
      try {
        res = await client.get(mode, { ...area[mode], status: 'Active', limit: config.limit, offset: (page - 1) * config.limit });
      } catch (err) {
        stop(search, 'network', `No response (${err.message}). The request is still counted.`);
        return { runId, runDir, requestsThisRun, stopped };
      }
      settle(paths.usage, n, res.status);
      if (res.status !== 200) {
        stop(search, 'http', errorMessage(res));
        return { runId, runDir, requestsThisRun, stopped };
      }

      // A 200 is billed even when the body is unexpected, so keep it.
      mkdirSync(runDir, { recursive: true });
      const file = `${mode}-page${page}.json`;
      writeFileSync(join(runDir, file), JSON.stringify(res.body, null, 2) + '\n');
      if (!Array.isArray(res.body)) {
        stop(search, 'shape', `${file}: expected a JSON array of listings; saved as received.`);
        return { runId, runDir, requestsThisRun, stopped };
      }
      search.pages.push({ file, count: res.body.length });
      log(`${areaKey} ${mode} page ${page}: ${res.body.length} listings (request ${n} of ${caps.requestCap})`);
      if (res.body.length < config.limit) {
        search.complete = true;
        save();
        break;
      }
      save();
    }
  }
  return { runId, runDir, requestsThisRun, stopped };
}

export function summarizeRun(result, paths, caps) {
  const lines = [];
  if (result.runDir) lines.push(`Saved to ${result.runDir}`);
  if (result.stopped) lines.push(`Run stopped (${result.stopped.type}): ${result.stopped.message}`);
  lines.push(`This run sent ${result.requestsThisRun} request${result.requestsThisRun === 1 ? '' : 's'}.`);
  lines.push(describeUsage(paths.usage, caps));
  return lines.join('\n');
}
