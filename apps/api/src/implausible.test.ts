import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findImplausibleFlags } from './implausible.js';
import type { Listing, Property } from './store.js';

const property = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'prop_test',
    street: '1 Main St',
    unit: null,
    city: 'Miami',
    zip: '33137',
    county: 'Miami-Dade',
    latitude: 25.8,
    longitude: -80.2,
    propertyType: 'condo',
    floodZone: null,
    beds: 2,
    bathsTotal: 1,
    bathsFull: 1,
    bathsHalf: 0,
    livingAreaSqft: 1000,
    lotSizeSqft: null,
    yearBuilt: 2000,
    parcelId: null,
    sample: true,
    riskDetails: {},
    valueOverrides: {},
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }) as unknown as Property;
const listing = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'lst_test',
    propertyId: 'prop_test',
    provider: 'mock',
    providerId: 'test',
    mlsName: null,
    mlsNumber: null,
    mode: 'sale',
    price: 500000,
    pricePeriod: 'total',
    status: 'active',
    hoaFee: null,
    imageUrls: [],
    sourceUrl: null,
    agentName: null,
    agentPhone: null,
    agentEmail: null,
    officeName: null,
    officePhone: null,
    officeEmail: null,
    providerListedDate: null,
    providerRemovedDate: null,
    providerLastSeenDate: null,
    firstFetchedAt: '',
    lastFetchedAt: '',
    fieldQuality: {},
    providerHistory: [],
    sample: true,
    implausibleFlags: [],
    ...overrides,
  }) as unknown as Listing;

describe('implausible listing checks', () => {
  it('flags price per square foot outside the configured local range', () => {
    const flags = findImplausibleFlags(
      property({ livingAreaSqft: 2900 }),
      listing({ price: 285000 }),
      {
        min: 450,
        max: 650,
        sample: true,
      },
    );
    assert.match(
      flags.find((flag) => flag.field === 'livingAreaSqft')!.reason,
      /\$98\/sq ft.*\$450–\$650 \(sample\)/,
    );
  });

  it('flags zero bedrooms for a single-family home and coordinates outside Florida', () => {
    const flags = findImplausibleFlags(
      property({ propertyType: 'single_family', beds: 0, latitude: 34 }),
      listing(),
    );
    assert.ok(flags.some((flag) => flag.field === 'beds'));
    assert.ok(flags.some((flag) => flag.field === 'latitude'));
  });

  it('flags missing key fields and leaves a complete ordinary listing clear', () => {
    const missing = findImplausibleFlags(
      property({ beds: null, livingAreaSqft: null }),
      listing({ price: null }),
    );
    assert.deepEqual(
      missing.map((flag) => flag.field),
      ['price', 'beds', 'livingAreaSqft'],
    );
    assert.deepEqual(findImplausibleFlags(property(), listing()), []);
  });
});
