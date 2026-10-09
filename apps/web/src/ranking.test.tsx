import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { defaultRankingWeights, rankListings, type RankingInput } from './ranking.js';

type FixtureProperty = {
  id: string;
  type: string;
  livingAreaSqft: number;
  floodZone: string | null;
  flags: Array<{ field: string; message: string }>;
  listings: Array<{ mode: string; price: number }>;
  costLines: Array<{ line: string; state: string; monthly?: number | null }>;
  rent: { value: number | null } | null;
  expected: { totalStatus: string; monthlyTotal?: number };
};

const lineStates: Record<string, string> = {
  calc: 'Calc',
  quote: 'Quote',
  est: 'Est.',
  na: 'N/A',
  doc: 'Doc',
  listing: 'Listing',
  unknown: 'Unknown',
};

// The fixture's seven sample homes in the shape Search receives from the local API.
const fixtureInputs = (
  JSON.parse(
    readFileSync(new URL('../../../fixtures/sample-data.json', import.meta.url), 'utf8'),
  ) as { properties: FixtureProperty[] }
).properties.map((home): RankingInput => {
  const totalStatus =
    home.expected.totalStatus === 'incomplete'
      ? 'Incomplete'
      : home.expected.totalStatus === 'estimate'
        ? 'Estimate'
        : 'Calculated';
  return {
    property: {
      id: home.id,
      propertyType: home.type,
      livingAreaSqft: home.livingAreaSqft,
      floodZone: home.floodZone,
    },
    listing: {
      id: home.id,
      mode: 'sale',
      price: home.listings.find((listing) => listing.mode === 'sale')!.price,
      pricePeriod: 'total',
      implausibleFlags: home.flags.map((flag) => ({ field: flag.field, reason: flag.message })),
    },
    comparableRent: { figure: { value: home.rent?.value ?? null } },
    costEstimate: {
      totalStatus,
      monthlyTotal: totalStatus === 'Incomplete' ? null : (home.expected.monthlyTotal ?? null),
      lines: home.costLines.map((line) => ({
        key: line.line,
        monthly: line.monthly ?? null,
        state: lineStates[line.state]!,
      })),
    },
  };
});

type RankingPatch = Omit<Partial<RankingInput>, 'property' | 'listing'> & {
  property?: Partial<RankingInput['property']>;
  listing?: Partial<RankingInput['listing']>;
};

const sale = (id: string, price: number | null, patch: RankingPatch = {}): RankingInput => ({
  ...patch,
  property: {
    id,
    propertyType: 'single_family',
    beds: 3,
    livingAreaSqft: 1500,
    floodZone: 'X',
    ...patch.property,
  },
  listing: {
    id,
    mode: 'sale',
    price,
    pricePeriod: 'total',
    hoaFee: 0,
    ...patch.listing,
  },
  comparableRent:
    patch.comparableRent === undefined ? { figure: { value: 3000 } } : patch.comparableRent,
  costEstimate:
    patch.costEstimate === undefined
      ? {
          totalStatus: 'Calculated',
          monthlyTotal: 2500,
          lines: [
            { key: 'hoa', monthly: 0, state: 'N/A' },
            { key: 'homeowners', monthly: 200, state: 'Estimate' },
          ],
        }
      : patch.costEstimate,
});

describe('computed ranking', () => {
  it('scales relative factors and assigns score ranks independently of display order', () => {
    const scores = rankListings([sale('high', 900000), sale('low', 300000)], 'sale');
    assert.ok(scores.get('low')!.score > scores.get('high')!.score);
    assert.equal(scores.get('low')!.rank, 1);
    assert.equal(scores.get('high')!.rank, 2);
    assert.equal(scores.get('low')!.factors.price?.score, 100);
  });

  it('scores Unknown factors as zero and explains provisional results', () => {
    const unknown = sale('unknown', null, {
      property: { floodZone: null, livingAreaSqft: null },
      comparableRent: null,
      costEstimate: { totalStatus: 'Incomplete', monthlyTotal: null, lines: [] },
    });
    const result = rankListings([unknown], 'sale').get('unknown')!;
    assert.equal(result.factors.price?.score, 0);
    assert.equal(result.factors.flood?.unknown, true);
    assert.equal(result.provisional, true);
    assert.match(result.provisionalReason ?? '', /factors unknown/);
  });

  it('uses the FEMA zone table and makes flagged living area Unknown', () => {
    const result = rankListings(
      [
        sale('x500', 400000, { property: { floodZone: 'X500' } }),
        sale('flagged', 500000, {
          listing: {
            implausibleFlags: [{ field: 'livingAreaSqft', reason: 'check price per sq ft' }],
          },
        }),
      ],
      'sale',
    );
    assert.equal(result.get('x500')!.factors.flood?.score, 80);
    assert.equal(result.get('flagged')!.factors.size?.unknown, true);
    assert.match(result.get('flagged')!.provisionalReason ?? '', /check price per sq ft/);
  });

  it('uses Rent weights and treats missing lease and flood inputs as Unknown', () => {
    const rentItem: RankingInput = {
      ...sale('rent', 2400),
      listing: { id: 'rent', mode: 'rent', price: 2400, pricePeriod: 'month' },
      property: { id: 'rent', propertyType: 'condo', livingAreaSqft: 900, floodZone: 'VE' },
    };
    const result = rankListings([rentItem], 'rent', defaultRankingWeights.rent).get('rent')!;
    assert.equal(result.factors.flood?.score, 10);
    assert.equal(result.factors.lease?.unknown, true);
    assert.equal(result.provisional, true);
  });

  it('explains provisional scores for the fixture homes and ranks them in score order', () => {
    const results = rankListings(fixtureInputs, 'sale');
    const reason = (id: string) => results.get(id)!.provisionalReason;
    assert.equal(reason('nmi-1460-ne-135th-st'), '1 factor unknown: comparable rent');
    assert.equal(
      reason('mia-3250-ne-2nd-ave-507'),
      '1 factor unknown: living area · check price per sq ft',
    );
    assert.equal(results.get('mia-3250-ne-2nd-ave-507')!.factors.size?.unknown, true);
    assert.equal(
      reason('boc-618-ne-7th-st'),
      '2 factors unknown: own-vs-rent gap (incomplete total), insurance',
    );
    assert.equal(
      reason('hol-2801-n-ocean-dr-9b'),
      '1 factor unknown: own-vs-rent gap (incomplete total)',
    );
    assert.equal(results.get('ftl-2207-ne-32nd-ct')!.provisional, false);

    const byRank = [...results.values()].sort((left, right) => left.rank - right.rank);
    assert.deepEqual(
      byRank.map((result) => result.rank),
      [1, 2, 3, 4, 5, 6, 7],
    );
    for (let index = 1; index < byRank.length; index += 1)
      assert.ok(byRank[index - 1]!.score >= byRank[index]!.score);
  });
});
