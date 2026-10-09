import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  computeCostEstimate,
  type CostEstimateInput,
  type CostLineState,
} from './cost-estimate.js';
import type { LocalAssumptions, Property, PropertyCostEntry, Listing } from './store.js';
import { emptyRiskDetails } from './store.js';

const property = (patch: Partial<Property> = {}): Property => ({
  id: 'prop_sample',
  street: '100 Main St',
  unit: null,
  city: 'Fort Lauderdale',
  zip: '33301',
  county: 'Broward',
  latitude: null,
  longitude: null,
  propertyType: 'single_family',
  floodZone: 'AE',
  riskDetails: { ...emptyRiskDetails },
  beds: 3,
  bathsTotal: 2,
  bathsFull: 2,
  bathsHalf: 0,
  livingAreaSqft: 1800,
  lotSizeSqft: null,
  yearBuilt: 1980,
  parcelId: null,
  sample: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

const listing = (patch: Partial<Listing> = {}): Listing => ({
  id: 'lst_sale',
  propertyId: 'prop_sample',
  provider: 'mock',
  providerId: 'sample-sale',
  mlsName: null,
  mlsNumber: null,
  mode: 'sale',
  price: 849_000,
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
  firstFetchedAt: '2026-10-01T00:00:00.000Z',
  lastFetchedAt: '2026-10-01T00:00:00.000Z',
  fieldQuality: {},
  implausibleFlags: [],
  providerHistory: [],
  sample: true,
  ...patch,
});

const local: LocalAssumptions = {
  county: 'Broward',
  set: true,
  millage: 19.5,
  typicalNonAdValoremPerYear: 700,
  homeownersDefaultMonthly: 520,
  ho6DefaultMonthly: 110,
  floodDefaultMonthly: { X: 50, AE: 180, VE: 420 },
  source: 'Sample county rates',
  setOn: '2026-10-07',
  sample: true,
};
const personal = {
  downPaymentPct: 20,
  mortgageRatePct: 6.5,
  termYears: 30,
  maintenancePctPerYear: 1,
};
const entry = (
  kind: PropertyCostEntry['kind'],
  patch: Partial<PropertyCostEntry> = {},
): PropertyCostEntry => ({
  id: 1,
  propertyId: 'prop_sample',
  kind,
  amount: null,
  state: 'Doc',
  source: 'Sample document',
  date: '2026-10-05',
  assessmentStatus: null,
  paymentType: null,
  amountUnknown: false,
  sample: true,
  ...patch,
});
const calculate = (patch: Partial<CostEstimateInput> = {}) =>
  computeCostEstimate({
    property: property(),
    saleListing: listing(),
    entries: [],
    localAssumption: local,
    personalAssumptions: personal,
    ...patch,
  })!;
const lineSummary = (estimate: ReturnType<typeof computeCostEstimate>) =>
  estimate?.lines
    .map((line) => [line.key, line.monthly, line.state] as const)
    .sort(([left], [right]) => left.localeCompare(right));

describe('purchase cost estimates', () => {
  it('matches all purchase cost lines, labels, totals, and upfront cash in the sample fixtures', () => {
    const fixtures = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../fixtures/sample-data.json', import.meta.url)),
        'utf8',
      ),
    ) as {
      personalAssumptions: typeof personal;
      localAssumptions: LocalAssumptions[];
      properties: Array<{
        id: string;
        address: string;
        unit: string | null;
        city: string;
        zip: string;
        county: string;
        type: string;
        beds: number;
        baths: number;
        livingAreaSqft: number;
        yearBuilt: number;
        floodZone: string | null;
        association: {
          status: string;
          feeMonthly?: number;
          feeSource?: string;
          specialAssessment?: string;
        };
        listings: Array<{ mode: 'sale' | 'rent'; price: number; hoaFee?: number }>;
        costLines: Array<{ line: string; state: string; monthly: number | null }>;
        expected: {
          totalStatus: string;
          statusLabel: string;
          monthlyTotal?: number;
          knownSubtotal?: number;
          upfrontCash: number | null;
          totalLabel?: string;
          upfrontLabel?: string;
        };
      }>;
    };
    const evidence: Record<string, PropertyCostEntry[]> = {
      'ftl-2207-ne-32nd-ct': [
        entry('tax_bill', { amount: 0, source: 'Sample tax bill · no CDD' }),
        entry('homeowners_quote', {
          amount: 610,
          state: 'Quote',
          source: 'Sample homeowners quote',
        }),
        entry('hoa_none', { state: 'N/A', source: 'Sample association confirmation' }),
      ],
      'mir-3418-sw-129th-ter': [
        entry('tax_bill_cdd', { amount: 2400, source: 'Sample tax bill · $2,400/year CDD' }),
      ],
    };
    const expectedStates: Record<string, CostLineState> = {
      calc: 'Calc',
      listing: 'Listing',
      quote: 'Quote',
      doc: 'Doc',
      na: 'N/A',
      est: 'Est.',
      unknown: 'Unknown',
    };

    for (const sample of fixtures.properties) {
      const sale = sample.listings.find((candidate) => candidate.mode === 'sale')!;
      const localData = fixtures.localAssumptions.find(
        (candidate) => candidate.county === sample.county,
      )!;
      const associationNone = sample.association.status === 'none_confirmed';
      const sampleProperty = property({
        id: `prop_${sample.id}`,
        street: sample.address,
        unit: sample.unit,
        city: sample.city,
        zip: sample.zip,
        county: sample.county,
        propertyType: sample.type,
        floodZone: sample.floodZone,
        beds: sample.beds,
        bathsTotal: sample.baths,
        livingAreaSqft: sample.livingAreaSqft,
        yearBuilt: sample.yearBuilt,
        riskDetails: {
          ...emptyRiskDetails,
          specialAssessment: sample.association.specialAssessment ?? null,
        },
      });
      const result = computeCostEstimate({
        property: sampleProperty,
        saleListing: listing({
          propertyId: sampleProperty.id,
          price: sale.price,
          hoaFee:
            sample.association.feeSource === 'listing'
              ? (sample.association.feeMonthly ?? null)
              : null,
        }),
        entries: associationNone
          ? [...(evidence[sample.id] ?? []), entry('hoa_none', { state: 'N/A' })]
          : (evidence[sample.id] ?? []),
        localAssumption: localData,
        personalAssumptions: fixtures.personalAssumptions,
        sameBuildingHoaMonthly:
          sample.association.feeSource === 'same_building_median'
            ? sample.association.feeMonthly
            : null,
      })!;

      assert.deepEqual(
        lineSummary(result),
        sample.costLines
          .map((line) => [line.line, line.monthly, expectedStates[line.state]] as const)
          .sort(([left], [right]) => left.localeCompare(right)),
        `${sample.id} cost lines`,
      );
      assert.equal(result.statusLabel, sample.expected.statusLabel, `${sample.id} status label`);
      assert.equal(
        result.totalStatus.toLowerCase(),
        sample.expected.totalStatus,
        `${sample.id} total status`,
      );
      assert.equal(result.monthlyTotal, sample.expected.monthlyTotal ?? null, `${sample.id} total`);
      assert.equal(
        result.knownSubtotal,
        sample.expected.knownSubtotal ??
          sample.costLines.reduce((sum, line) => sum + (line.monthly ?? 0), 0),
        `${sample.id} known subtotal`,
      );
      if (sample.expected.totalLabel)
        assert.equal(result.totalLabel, sample.expected.totalLabel, `${sample.id} total label`);
      assert.equal(
        result.upfrontCash,
        sample.expected.upfrontCash ??
          (sale.price * fixtures.personalAssumptions.downPaymentPct) / 100,
        `${sample.id} upfront cash`,
      );
      if (sample.expected.upfrontLabel)
        assert.equal(result.upfrontLabel, sample.expected.upfrontLabel);
    }
  });

  it('computes every standard line and the Fort Lauderdale fixture total', () => {
    const result = calculate({
      entries: [
        entry('tax_bill', { amount: 0, source: 'Tax bill shows no CDD' }),
        entry('homeowners_quote', { amount: 610, state: 'Quote', source: 'Insurance quote' }),
        entry('hoa_none', { state: 'N/A', source: 'Confirmed no association' }),
      ],
    });
    assert.deepEqual(
      lineSummary(result),
      [
        ['principalInterest', 4293, 'Calc'],
        ['propertyTax', 1380, 'Calc'],
        ['homeowners', 610, 'Quote'],
        ['flood', 180, 'Est.'],
        ['hoa', 0, 'N/A'],
        ['nonAdValorem', 0, 'Doc'],
        ['specialAssessment', 0, 'N/A'],
        ['maintenance', 708, 'Calc'],
      ].sort(([left], [right]) => String(left).localeCompare(String(right))),
    );
    assert.equal(result.monthlyTotal, 7171);
    assert.equal(result.totalStatus, 'Estimate');
    assert.equal(result.statusLabel, 'Estimate · needs flood quote');
    assert.equal(result.upfrontCash, 169800);
  });

  it('uses townhome homeowners defaults, listing HOA, annual CDD documents, and estimate order', () => {
    const result = calculate({
      property: property({ propertyType: 'townhome', floodZone: 'X' }),
      saleListing: listing({ price: 465000, hoaFee: 260 }),
      entries: [entry('tax_bill_cdd', { amount: 2400 })],
    });
    assert.equal(result.lines.find((line) => line.key === 'homeowners')?.monthly, 520);
    assert.equal(result.lines.find((line) => line.key === 'hoa')?.state, 'Listing');
    assert.equal(result.lines.find((line) => line.key === 'nonAdValorem')?.monthly, 200);
    assert.equal(
      result.statusLabel,
      'Estimate · needs insurance quote, assessments not checked +1',
    );
    assert.equal(result.upfrontCash, 93000);
  });

  it('prefers property quotes and documents over unavailable county rates', () => {
    const result = calculate({
      property: property({ county: 'Palm Beach' }),
      entries: [
        entry('homeowners_quote', { amount: 610, state: 'Quote' }),
        entry('flood_quote', { amount: 155, state: 'Quote' }),
        entry('tax_bill_cdd', { amount: 1200 }),
      ],
      localAssumption: { ...local, county: 'Palm Beach', set: false, millage: null },
    });
    assert.equal(result.lines.find((line) => line.key === 'homeowners')?.state, 'Quote');
    assert.equal(result.lines.find((line) => line.key === 'flood')?.state, 'Quote');
    assert.equal(result.lines.find((line) => line.key === 'nonAdValorem')?.state, 'Doc');
    assert.equal(result.lines.find((line) => line.key === 'propertyTax')?.state, 'Unknown');
    assert.equal(result.totalStatus, 'Incomplete');
    assert.equal(result.statusLabel, 'Incomplete · no Palm Beach rates');
    assert.equal(result.knownSubtotal, 5866);
  });

  it('handles the four Incomplete triggers and keeps a single-family configured home estimable', () => {
    const knownCdd = calculate({
      entries: [entry('tax_bill_cdd', { amountUnknown: true })],
    });
    assert.equal(knownCdd.statusLabel, 'Incomplete · CDD amount unknown');

    const unknownAssessment = calculate({
      property: property({
        propertyType: 'condo',
        riskDetails: {
          ...emptyRiskDetails,
          specialAssessment: 'pending',
          assessmentPaymentType: 'one_time',
        },
      }),
      saleListing: listing({ hoaFee: 1150 }),
    });
    assert.equal(unknownAssessment.statusLabel, 'Incomplete · special assessment amount unknown');
    assert.equal(unknownAssessment.upfrontAssessmentUnknown, true);
    assert.equal(unknownAssessment.upfrontCash, 169800);

    const missingHoa = calculate({
      property: property({ propertyType: 'condo' }),
    });
    assert.equal(missingHoa.statusLabel, 'Incomplete · HOA fee unknown');

    const noLocal = calculate({ localAssumption: { ...local, set: false, millage: null } });
    assert.equal(noLocal.statusLabel, 'Incomplete · no Broward rates');
    assert.equal(noLocal.lines.find((line) => line.key === 'nonAdValorem')?.state, 'Unknown');
  });

  it('uses same-building HOA estimates and puts known one-time assessments in upfront cash', () => {
    const result = calculate({
      property: property({ propertyType: 'condo' }),
      saleListing: listing({ price: 529000 }),
      sameBuildingHoaMonthly: 640,
      entries: [entry('special_assessment', { amount: 12000, paymentType: 'one_time' })],
    });
    assert.equal(result.lines.find((line) => line.key === 'hoa')?.state, 'Est.');
    assert.equal(result.lines.find((line) => line.key === 'specialAssessment')?.monthly, 0);
    assert.equal(result.upfrontCash, 117800);
  });

  it('returns no estimate for rentals or purchase listings without a price', () => {
    assert.equal(calculate({ saleListing: listing({ mode: 'rent' }) }), null);
    assert.equal(calculate({ saleListing: listing({ price: null }) }), null);
  });
});
