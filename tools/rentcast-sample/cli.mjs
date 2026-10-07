// Milestone 0 sample pull for RentCast's free tier. Standalone: nothing here is part of the app.
// Run from the project root:  node tools/rentcast-sample/cli.mjs <command>   (see README.md in this folder)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ConfigError, HARD_REQUEST_CAP, parseCaps, parseConfig, readConfigFile } from './lib/config.mjs';
import { createClient } from './lib/client.mjs';
import { CapError, describeUsage } from './lib/usage.mjs';
import { pullArea, summarizeRun } from './lib/pull.mjs';
import { queryFromListing, runEstimate } from './lib/estimate.mjs';
import { findSaleListing, loadRuns } from './lib/runs.mjs';
import { coverage, formatReport } from './lib/report.mjs';
import { PICKS_PER_CELL, pickCells, picksCsv } from './lib/picks.mjs';
import { checkedProviderIds, loadSheets, modeOf } from './lib/sheet.mjs';
import { formatScore, scoreEvaluation } from './lib/score.mjs';
import { findCandidates, formatCandidates } from './lib/lookup.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const local = join(here, 'local'); // git-ignored: raw responses, usage count, picks
const paths = {
  config: join(here, 'config.local.json'), // git-ignored: holds the API key
  usage: join(local, 'usage.json'),
  raw: join(local, 'raw'),
  estimates: join(local, 'estimates'),
  picks: join(local, 'picks'),
};

const HELP = `RentCast Milestone 0 sample pull (hard cap: ${HARD_REQUEST_CAP} requests in all)

  node tools/rentcast-sample/cli.mjs pull <area>                 sale + rental searches for one area
  node tools/rentcast-sample/cli.mjs estimate --listing <id>     rent estimate for a saved sale listing
  node tools/rentcast-sample/cli.mjs estimate --address "<street, city, state, zip>" [--property-type T] [--bedrooms N] [--bathrooms N] [--square-footage N]
  node tools/rentcast-sample/cli.mjs report [--run <runId>]...   coverage report; sends no requests
  node tools/rentcast-sample/cli.mjs picks [--seed <seed>] [--run <runId>]... [--mode sale|rental] [--per-cell N] [--exclude-checked]   seeded picks; sends no requests
  node tools/rentcast-sample/cli.mjs lookup "<street address>" [--unit U] [--mode sale|rental] [--beds N] [--sqft N]   candidates in the saved pull for a public listing; sends no requests
  node tools/rentcast-sample/cli.mjs score [--sheet <file>]... [--run <runId>]...   score the record sheets with the plan's rules; sends no requests
  node tools/rentcast-sample/cli.mjs usage                       requests used so far`;

function loadConfig() {
  const raw = readConfigFile(paths.config);
  if (!raw) throw new ConfigError([`no config at ${paths.config}. Copy config.example.json there and fill it in.`]);
  return parseConfig(raw);
}

async function pull(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const config = loadConfig();
  const areaKey = positionals[0];
  if (!areaKey || !config.areas[areaKey]) {
    throw new Error(`Name one area to pull: ${Object.keys(config.areas).join(', ')}`);
  }
  const client = createClient({ apiKey: config.apiKey });
  const result = await pullArea({ areaKey, area: config.areas[areaKey], config, client, paths, log: console.log });
  console.log(summarizeRun(result, paths, config));
  if (!result.stopped) return 0;
  return result.stopped.type === 'cap' ? 2 : 1;
}

async function estimate(args) {
  const { values } = parseArgs({
    args,
    options: {
      listing: { type: 'string' },
      address: { type: 'string' },
      'property-type': { type: 'string' },
      bedrooms: { type: 'string' },
      bathrooms: { type: 'string' },
      'square-footage': { type: 'string' },
    },
  });
  if (!values.listing === !values.address) throw new Error('Give either --listing <id> or --address "<street, city, state, zip>".');

  let query;
  if (values.listing) {
    const listing = findSaleListing(paths.raw, values.listing);
    if (!listing) throw new Error(`No saved sale listing with id ${values.listing} in the latest run of any area.`);
    query = queryFromListing(listing);
  } else {
    query = Object.fromEntries(
      Object.entries({
        address: values.address,
        propertyType: values['property-type'],
        bedrooms: values.bedrooms,
        bathrooms: values.bathrooms,
        squareFootage: values['square-footage'],
      }).filter(([, v]) => v != null),
    );
  }

  const config = loadConfig();
  const client = createClient({ apiKey: config.apiKey });
  const { file, response } = await runEstimate({ query, config, client, paths });
  const comps = response.comparables?.length ?? 0;
  console.log(`Rent estimate $${response.rent} (range $${response.rentRangeLow} to $${response.rentRangeHigh}), ${comps} comparables.`);
  console.log(`Saved to ${file}`);
  console.log(describeUsage(paths.usage, config));
  return 0;
}

function report(args) {
  const { values } = parseArgs({ args, options: { run: { type: 'string', multiple: true } } });
  console.log(formatReport(loadRuns(paths.raw, values.run)));
  return 0;
}

function picks(args) {
  const { values } = parseArgs({ args, options: { seed: { type: 'string' }, run: { type: 'string', multiple: true }, mode: { type: 'string' }, 'per-cell': { type: 'string' }, 'exclude-checked': { type: 'boolean' } } });
  const seed = values.seed ?? String(randomInt(10_000_000, 100_000_000));
  const mode = values.mode && modeOf(values.mode);
  if (values.mode && !mode) throw new Error('--mode is sale or rental.');
  const count = values['per-cell'] === undefined ? PICKS_PER_CELL : Number(values['per-cell']);
  if (!Number.isInteger(count) || count < 1) throw new Error('--per-cell is a whole number, 1 or more.');
  // The borderline rule (plan, step 5): 10 more for one mode and direction, 5 per county, new listings.
  const file = join(paths.picks, `picks-${seed}.csv`);
  const exclude = values['exclude-checked'] ? checkedProviderIds(paths.picks, basename(file)) : null;
  const runs = loadRuns(paths.raw, values.run);
  const cells = pickCells(runs, seed, count, { modes: mode ? [mode] : null, exclude });

  console.log(`Seed: ${seed}   (rerun with --seed ${seed} to get the same picks)`);
  if (exclude) console.log(`Leaving out ${exclude.size} listings already in a still-available sheet.`);
  for (const cell of cells) {
    console.log(`\n${cell.county} · ${cell.mode} · ${cell.picks.length} of ${cell.poolSize} active · run ${cell.runId}`);
    if (cell.picks.length < count) console.log(`  Only ${cell.picks.length} active listings to pick from; asked for ${count}. Nothing is skipped or replaced.`);
    cell.picks.forEach((l, i) => console.log(`  ${i + 1}. ${l.formattedAddress} · ${l.price != null ? '$' + l.price : 'no price'} · MLS ${l.mlsNumber ?? 'none'} · ${l.id}`));
    const hours = (Date.now() - Date.parse(cell.fetchedAt)) / 3.6e6;
    if (hours > 24) console.log(`  Pulled ${Math.round(hours)} hours ago; the plan wants the still-available check within 24 hours of the pull.`);
  }

  // The sheet gets hand-entered results, so an existing one is never overwritten.
  if (existsSync(file)) {
    console.log(`\n${file} already exists and was left alone; it may hold your entries.`);
  } else {
    mkdirSync(paths.picks, { recursive: true });
    writeFileSync(file, picksCsv(cells, seed));
    console.log(`\nSheet saved to ${file}`);
  }
  return 0;
}

// Coverage check helper: which saved provider listings could be this public listing? The classification stays yours.
function lookup(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { unit: { type: 'string' }, mode: { type: 'string' }, beds: { type: 'string' }, sqft: { type: 'string' }, run: { type: 'string', multiple: true } },
  });
  const address = positionals.join(' ').trim();
  if (!address) throw new Error('Give the street address of the public listing, in quotes, for example: lookup "100 Example Ave" --unit 4B');
  const mode = values.mode && modeOf(values.mode);
  if (values.mode && !mode) throw new Error('--mode is sale or rental.');
  const number = (name) => {
    if (values[name] === undefined) return null;
    const n = Number(values[name].replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new Error(`--${name} is a number.`);
    return n;
  };
  const query = { address, unit: values.unit ?? '', mode: mode || null, beds: number('beds'), sqft: number('sqft') };
  console.log(formatCandidates(findCandidates(loadRuns(paths.raw, values.run), query), query));
  return 0;
}

// Applies the plan's scoring rules (step 5) to the record sheets and the saved pulls. Prints counts only.
function score(args) {
  const { values } = parseArgs({ args, options: { sheet: { type: 'string', multiple: true }, run: { type: 'string', multiple: true } } });
  const cells = loadRuns(paths.raw, values.run).flatMap(coverage);
  const { rows, files } = loadSheets(paths.picks, values.sheet);
  console.log(`Record sheets read: ${files.length} (${rows.length} rows). Nothing below names a listing.\n`);
  console.log(formatScore(scoreEvaluation({ rows, cells }), rows));
  return 0;
}

function usage() {
  console.log(describeUsage(paths.usage, parseCaps(readConfigFile(paths.config))));
  return 0;
}

const commands = { pull, estimate, report, picks, lookup, score, usage };

async function main(argv) {
  const [command, ...args] = argv;
  if (!commands[command]) {
    console.error(HELP);
    return command ? 1 : 0;
  }
  try {
    return await commands[command](args);
  } catch (err) {
    console.error(err.message);
    return err instanceof CapError ? 2 : 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
