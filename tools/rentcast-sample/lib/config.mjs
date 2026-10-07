// Local config for the Milestone 0 sample pull. It lives in a git-ignored file because it holds the API key.
import { existsSync, readFileSync } from 'node:fs';

export const HARD_REQUEST_CAP = 40;  // plan, Provider evaluation step 2: at most 40 of the 50 free requests
export const HARD_ESTIMATE_CAP = 5;  // up to 5 rent-estimate calls, counted inside the same 40
export const MAX_PAGE_SIZE = 500;    // RentCast's largest `limit`
export const MODES = ['sale', 'rental'];

// Set by the script itself, so a search can't be pointed at something else by mistake.
const RESERVED_PARAMS = ['status', 'limit', 'offset'];
const PLACEHOLDER = /REPLACE_ME/;

export class ConfigError extends Error {
  constructor(problems) {
    super('Config problems:\n' + problems.map((p) => '  - ' + p).join('\n'));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

// Returns the parsed file, or null when it doesn't exist.
export function readConfigFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError([`${path} is not valid JSON (${err.message})`]);
  }
}

function readInt(raw, key, max, problems) {
  const value = raw?.[key] ?? max;
  if (Number.isInteger(value) && value >= 1 && value <= max) return value;
  problems.push(`${key} must be a whole number from 1 to ${max}`);
  return max;
}

function readCaps(raw, problems) {
  return {
    requestCap: readInt(raw, 'requestCap', HARD_REQUEST_CAP, problems),
    rentEstimateCap: readInt(raw, 'rentEstimateCap', HARD_ESTIMATE_CAP, problems),
  };
}

// The caps are all `usage` needs, so it works before the key and areas are filled in.
export function parseCaps(raw) {
  const problems = [];
  const caps = readCaps(raw, problems);
  if (problems.length) throw new ConfigError(problems);
  return caps;
}

// A search with no location would spend a request on listings from across the country.
const hasLocation = (p) => Boolean(p.zipCode || (p.city && p.state) || (p.latitude != null && p.longitude != null));

function checkSearch(at, params, problems) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    problems.push(`${at} must be an object of RentCast search parameters`);
    return;
  }
  for (const [key, value] of Object.entries(params)) {
    if (RESERVED_PARAMS.includes(key)) problems.push(`${at}.${key} is set by the script; remove it`);
    else if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') problems.push(`${at}.${key} must be a non-empty string or number`);
    else if (PLACEHOLDER.test(String(value))) problems.push(`${at}.${key} still says REPLACE_ME`);
  }
  if (!hasLocation(params)) problems.push(`${at} needs a location: zipCode, city with state, or latitude with longitude`);
}

export function parseConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new ConfigError(['the config file is empty']);
  const problems = [];
  const caps = readCaps(raw, problems);
  const limit = readInt(raw, 'limit', MAX_PAGE_SIZE, problems);

  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (!apiKey) problems.push('apiKey is missing');
  else if (PLACEHOLDER.test(apiKey)) problems.push('apiKey still says REPLACE_ME');

  const areas = raw.areas && typeof raw.areas === 'object' ? raw.areas : {};
  if (!Object.keys(areas).length) problems.push('areas is empty: add one search area per county');
  for (const [key, area] of Object.entries(areas)) {
    if (typeof area?.county !== 'string' || !area.county.trim()) problems.push(`areas.${key}.county is required`);
    for (const mode of MODES) checkSearch(`areas.${key}.${mode}`, area?.[mode], problems);
  }

  if (problems.length) throw new ConfigError(problems);
  return { apiKey, ...caps, limit, areas };
}
