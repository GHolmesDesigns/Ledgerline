import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase, persistDatabase } from './database.js';
import { findComparableRent } from './comparable-rent.js';
import { createStore, type ListingInput, type Store } from './store.js';
import type { Database } from 'sql.js';

const directories: string[] = [];
let database: Database;
let store: Store;
const now = new Date('2026-10-09T12:00:00.000Z');

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-rent-comps-'));
  directories.push(directory);
  database = await openDatabase(join(directory, 'ledgerline.sqlite'));
  store = createStore(database, { clock: () => now, afterWrite: () => persistDatabase(database) });
});

afterEach(() => {
  try {
    closeDatabase(database);
  } catch {
    /* already closed */
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const rental = (providerId: string, price: number, lastSeen: string): ListingInput => ({
  provider: 'mock',
  providerId,
  mode: 'rent',
  price,
  pricePeriod: 'month',
  status: 'active',
  providerLastSeenDate: lastSeen,
});

describe('comparable rent', () => {
  it('uses a saved RentCast estimate only after same-home and local comp sources', () => {
    const home = store.createProperty({
      street: '1 Estimate St',
      city: 'Miami',
      zip: '33131',
      propertyType: 'condo',
      beds: 2,
      livingAreaSqft: 1000,
      latitude: 25.76,
      longitude: -80.19,
    });
    store.saveComparableRentFigure({
      propertyId: home.id,
      source: 'rent_estimate',
      value: 3250,
      low: 3000,
      high: 3500,
      reason: null,
      compCount: 1,
      maxDistanceMi: 0.4,
      compIds: ['rent-comp-1'],
      estimateComps: [{ address: '2 Estimate St', rent: 3200, distanceMi: 0.4 }],
      computedAt: now.toISOString(),
    });
    const estimate = findComparableRent(store, home.id, store.getComparableRentRules(), now)!;
    assert.equal(estimate.figure.source, 'rent_estimate');
    assert.equal(estimate.figure.value, 3250);
    assert.match(estimate.label, /RentCast estimate · range \$3,000–\$3,500 · Oct 9/);
    assert.deepEqual(estimate.estimateComps, [
      { address: '2 Estimate St', rent: 3200, distanceMi: 0.4 },
    ]);

    store.replaceListings(home.id, [rental('same-home-after-estimate', 3400, '2026-10-08')]);
    assert.equal(
      findComparableRent(store, home.id, store.getComparableRentRules(), now)?.figure.source,
      'same_home',
    );
  });

  it('prefers an active rental on the same property and records its source date', () => {
    const home = store.createProperty({
      street: '1 Main St',
      city: 'Fort Lauderdale',
      zip: '33308',
      propertyType: 'single_family',
      beds: 3,
      livingAreaSqft: 1800,
      latitude: 26,
      longitude: -80,
    });
    store.replaceListings(home.id, [rental('same-home', 5200, '2026-09-28')]);
    const result = findComparableRent(store, home.id, store.getComparableRentRules(), now)!;
    assert.equal(result.figure.source, 'same_home');
    assert.equal(result.figure.value, 5200);
    assert.equal(result.label, 'same home · listed Sep 28');
    assert.equal(result.figure.compIds.length, 1);
    assert.equal(result.comps.length, 0);
    assert.equal(store.getComparableRentFigure(home.id)?.value, 5200);
  });

  it('uses the median of qualifying active rentals, and refreshes the stored figure', () => {
    const home = store.createProperty({
      street: '1 Main St',
      city: 'Miami',
      zip: '33131',
      propertyType: 'condo',
      beds: 2,
      livingAreaSqft: 1000,
      latitude: 25.76,
      longitude: -80.19,
    });
    store.createSavedSearch({ name: 'Miami · Rent', mode: 'rent', location: 'Miami 33131' });
    [3000, 3400, 3600, 4000].forEach((price, index) => {
      const comp = store.createProperty({
        street: `${index + 2} Main St`,
        city: 'Miami',
        zip: '33131',
        propertyType: 'condo',
        beds: 2,
        livingAreaSqft: 1000 + index * 20,
        latitude: 25.76,
        longitude: -80.19 - (index + 1) * 0.002,
      });
      store.replaceListings(comp.id, [rental(`comp-${index}`, price, '2026-10-05')]);
    });
    const result = findComparableRent(store, home.id, store.getComparableRentRules(), now)!;
    assert.equal(result.figure.source, 'local_comps');
    assert.equal(result.figure.value, 3500);
    assert.equal(result.figure.compCount, 4);
    assert.ok(result.figure.maxDistanceMi! <= 1);
    assert.equal(result.comps.length, 4);
  });

  it('returns unavailable with only two qualifying comps, then applies the editable minimum', () => {
    const home = store.createProperty({
      street: '1 Main St',
      city: 'North Miami',
      zip: '33161',
      propertyType: 'single_family',
      beds: 3,
      livingAreaSqft: 1400,
      latitude: 25.9,
      longitude: -80.17,
    });
    store.createSavedSearch({
      name: 'North Miami · Rent',
      mode: 'rent',
      location: 'North Miami 33161',
    });
    for (const [index, price] of [3000, 3200].entries()) {
      const comp = store.createProperty({
        street: `${index + 2} Main St`,
        city: 'North Miami',
        zip: '33161',
        propertyType: 'single_family',
        beds: 3,
        livingAreaSqft: 1400,
        latitude: 25.9,
        longitude: -80.17 - (index + 1) * 0.002,
      });
      store.replaceListings(comp.id, [rental(`two-${index}`, price, '2026-10-05')]);
    }
    const unavailable = findComparableRent(store, home.id, store.getComparableRentRules(), now)!;
    assert.equal(unavailable.figure.value, null);
    assert.equal(unavailable.label, 'Unavailable · only 2 local comps');
    const allowed = findComparableRent(
      store,
      home.id,
      { ...store.getComparableRentRules(), minComps: 2 },
      now,
    )!;
    assert.equal(allowed.figure.value, 3100);
    assert.equal(allowed.label, '2 local comps · median · within 0.2 mi');
  });

  it('enforces type, beds, area, radius, status, and freshness boundaries', () => {
    const home = store.createProperty({
      street: '1 Main St',
      city: 'Miami',
      zip: '33131',
      propertyType: 'condo',
      beds: 2,
      livingAreaSqft: 1000,
      latitude: 25.76,
      longitude: -80.19,
    });
    store.createSavedSearch({ name: 'Miami · Rent', mode: 'rent', location: 'Miami' });
    const candidates = [
      { type: 'condo', beds: 2, area: 1200, delta: 0.014, status: 'active', seen: '2026-10-09' },
      { type: 'condo', beds: 2, area: 1201, delta: 0.005, status: 'active', seen: '2026-10-09' },
      {
        type: 'single_family',
        beds: 2,
        area: 1000,
        delta: 0.005,
        status: 'active',
        seen: '2026-10-09',
      },
      { type: 'condo', beds: 3, area: 1000, delta: 0.005, status: 'active', seen: '2026-10-09' },
      { type: 'condo', beds: 2, area: 1000, delta: 0.005, status: 'pending', seen: '2026-10-09' },
      { type: 'condo', beds: 2, area: 1000, delta: 0.005, status: 'active', seen: '2026-09-08' },
      { type: 'condo', beds: 2, area: 1000, delta: 0.03, status: 'active', seen: '2026-10-09' },
    ];
    candidates.forEach((candidate, index) => {
      const comp = store.createProperty({
        street: `${index + 2} Main St`,
        city: 'Miami',
        zip: '33131',
        propertyType: candidate.type,
        beds: candidate.beds,
        livingAreaSqft: candidate.area,
        latitude: 25.76,
        longitude: -80.19 - candidate.delta,
      });
      store.replaceListings(comp.id, [
        rental(`boundary-${index}`, 3000 + index * 100, candidate.seen).status === candidate.status
          ? rental(`boundary-${index}`, 3000 + index * 100, candidate.seen)
          : {
              ...rental(`boundary-${index}`, 3000 + index * 100, candidate.seen),
              status: candidate.status,
            },
      ]);
    });
    const result = findComparableRent(store, home.id, store.getComparableRentRules(), now)!;
    assert.equal(result.figure.compCount, 1);
    assert.equal(result.comps[0]?.address, '2 Main St');
  });

  it('explains missing Rent search coverage without inventing a value', () => {
    const home = store.createProperty({
      street: '1 Main St',
      city: 'Boca Raton',
      zip: '33432',
      propertyType: 'single_family',
      beds: 3,
      livingAreaSqft: 1600,
      latitude: 26.36,
      longitude: -80.08,
    });
    const result = findComparableRent(store, home.id, store.getComparableRentRules(), now)!;
    assert.equal(result.label, 'Unavailable · no Rent search covers this area');
    assert.equal(result.figure.value, null);
  });
});
