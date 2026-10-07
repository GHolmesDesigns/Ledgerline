// Milestone 0 sample pull for RentCast's free tier. Standalone: nothing here is part of the app.
// Run from the project root:  node tools/rentcast-sample/cli.mjs <command>   (see README.md in this folder)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ConfigError, HARD_REQUEST_CAP, parseCaps, parseConfig, readConfigFile } from './lib/config.mjs';
import { createClient } from './lib/client.mjs';
import { CapError, describeUsage } from './lib/usage.mjs';
import { pullArea, summarizeRun } from './lib/pull.mjs';
import { queryFromListing, runEstimate } from './lib/estimate.mjs';
import { findSaleListing, loadRuns } from './lib/runs.mjs';
import { formatReport } from './lib/report.mjs';
import { PICKS_PER_CELL, pickCells, picksCsv } from './lib/picks.mjs';

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
  node tools/rentcast-sample/cli.mjs picks [--seed <seed>] [--run <runId>]...   seeded picks; sends no requests
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
  const { values } = parseArgs({ args, options: { seed: { type: 'string' }, run: { type: 'string', multiple: true } } });
  const seed = values.seed ?? String(randomInt(10_000_000, 100_000_000));
  const runs = loadRuns(paths.raw, values.run);
  const cells = pickCells(runs, seed);

  console.log(`Seed: ${seed}   (rerun with --seed ${seed} to get the same picks)`);
  for (const cell of cells) {
    console.log(`\n${cell.county} · ${cell.mode} · ${cell.picks.length} of ${cell.poolSize} active · run ${cell.runId}`);
    if (cell.picks.length < PICKS_PER_CELL) console.log(`  Only ${cell.picks.length} active listings to pick from; the plan calls for ${PICKS_PER_CELL}. Nothing is skipped or replaced.`);
    cell.picks.forEach((l, i) => console.log(`  ${i + 1}. ${l.formattedAddress} · ${l.price != null ? '$' + l.price : 'no price'} · MLS ${l.mlsNumber ?? 'none'} · ${l.id}`));
    const hours = (Date.now() - Date.parse(cell.fetchedAt)) / 3.6e6;
    if (hours > 24) console.log(`  Pulled ${Math.round(hours)} hours ago; the plan wants the still-available check within 24 hours of the pull.`);
  }

  // The sheet gets hand-entered results, so an existing one is never overwritten.
  const file = join(paths.picks, `picks-${seed}.csv`);
  if (existsSync(file)) {
    console.log(`\n${file} already exists and was left alone; it may hold your entries.`);
  } else {
    mkdirSync(paths.picks, { recursive: true });
    writeFileSync(file, picksCsv(cells, seed));
    console.log(`\nSheet saved to ${file}`);
  }
  return 0;
}

function usage() {
  console.log(describeUsage(paths.usage, parseCaps(readConfigFile(paths.config))));
  return 0;
}

const commands = { pull, estimate, report, picks, usage };

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
