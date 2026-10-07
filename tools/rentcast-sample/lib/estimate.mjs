// Rent-estimate calls: 1 request each, counted against the same cap, and at most 5 in all.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage } from './client.mjs';
import { reserve, settle } from './usage.mjs';
import { stamp } from './pull.mjs';

// Builds the estimate query from a saved listing, so the property attributes aren't retyped by hand.
export function queryFromListing(listing) {
  const query = {
    address: listing.formattedAddress,
    propertyType: listing.propertyType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    squareFootage: listing.squareFootage,
  };
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v != null && v !== ''));
}

export async function runEstimate({ query, config, client, paths, now = () => new Date() }) {
  const caps = { requestCap: config.requestCap, rentEstimateCap: config.rentEstimateCap };
  const n = reserve(paths.usage, { kind: 'rent-estimate', note: 'rent estimate' }, caps, now());
  let res;
  try {
    res = await client.get('rent-estimate', query);
  } catch (err) {
    throw new Error(`No response (${err.message}). The request is still counted.`);
  }
  settle(paths.usage, n, res.status);
  if (res.status !== 200) throw new Error(errorMessage(res));

  mkdirSync(paths.estimates, { recursive: true });
  const fetchedAt = now();
  const file = join(paths.estimates, `${stamp(fetchedAt)}-request${n}.json`);
  writeFileSync(file, JSON.stringify({ fetchedAt: fetchedAt.toISOString(), query, response: res.body }, null, 2) + '\n');
  return { file, response: res.body };
}
