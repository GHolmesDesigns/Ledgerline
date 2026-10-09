import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultRankingWeights, rankListings, type RankingInput } from './ranking.js';

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
});
