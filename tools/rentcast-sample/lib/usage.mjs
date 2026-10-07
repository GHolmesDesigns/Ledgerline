// Request counter shared by every run. The plan's 40-request cap is enforced here, before a request is sent.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class CapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CapError';
  }
}

export function readUsage(path) {
  if (!existsSync(path)) return { requests: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Starting over would hide how many requests are already spent, so never reset it silently.
    throw new Error(`${path} is unreadable. Fix or restore it; the script will not reset the request count.`);
  }
}

export function summarize(usage) {
  return {
    total: usage.requests.length,
    estimates: usage.requests.filter((r) => r.kind === 'rent-estimate').length,
  };
}

function writeUsage(path, usage) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(usage, null, 2) + '\n');
  renameSync(tmp, path);
}

// Counts the request before it is sent, so a crash mid-request can't leave it uncounted.
// Throws CapError, with nothing written, when the request would pass a cap.
export function reserve(path, { kind, note }, caps, now = new Date()) {
  const usage = readUsage(path);
  const { total, estimates } = summarize(usage);
  if (total + 1 > caps.requestCap) {
    throw new CapError(`Stopped before sending: ${total} of ${caps.requestCap} requests are already used, so one more would pass the cap. Nothing was sent.`);
  }
  if (kind === 'rent-estimate' && estimates + 1 > caps.rentEstimateCap) {
    throw new CapError(`Stopped before sending: ${estimates} of ${caps.rentEstimateCap} rent-estimate calls are already used, so one more would pass that cap. Nothing was sent.`);
  }
  const n = total + 1;
  usage.requests.push({ n, at: now.toISOString(), kind, note, status: null });
  writeUsage(path, usage);
  return n;
}

// Records the HTTP status. A request that never gets one keeps status null and still counts.
export function settle(path, n, status) {
  const usage = readUsage(path);
  const entry = usage.requests.find((r) => r.n === n);
  if (entry) entry.status = status;
  writeUsage(path, usage);
}

export function describeUsage(path, caps) {
  const { total, estimates } = summarize(readUsage(path));
  return `Requests used: ${total} of ${caps.requestCap}. Rent estimates: ${estimates} of ${caps.rentEstimateCap}.`;
}
