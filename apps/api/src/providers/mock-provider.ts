import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ListingInput, PropertyInput, Store } from '../store.js';
import type {
  ListingProvider,
  ProviderCapabilities,
  ProviderListing,
  SearchCriteria,
} from './listing-provider.js';

interface SampleListing {
  mode: 'sale' | 'rent';
  price: number;
  status: string;
  listedOn?: string;
  lastSeen?: string;
  sample?: boolean;
}

interface SampleProperty {
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
  floodZone?: string;
  roofYear?: number | null;
  windMitigation?: string[];
  association?: {
    status?: string;
    milestoneInspection?: string;
    countyRecertification?: string;
    reserveStudy?: string;
    specialAssessment?: string;
    rentalRestrictions?: string;
    approvalRestrictions?: string;
  };
  listings: SampleListing[];
}

interface SampleData {
  asOf: string;
  properties: SampleProperty[];
  rentComps?: Record<
    string,
    Array<{
      address: string;
      beds: number;
      sqft: number;
      distanceMi: number;
      rent: number;
      lastSeen: string;
    }>
  >;
  savedSearches: Array<{
    area: string;
    buy: { requestsPerRefresh: number };
    rent: { requestsPerRefresh: number } | null;
  }>;
  matchReview: {
    incoming: {
      address: string;
      unit: string;
      city: string;
      mode: 'sale' | 'rent';
      price: number;
      seen: string;
    };
    existing: { address: string; unit: string | null; city?: string; zip?: string };
  };
}

const fixturePath = fileURLToPath(
  new URL('../../../../fixtures/sample-data.json', import.meta.url),
);
const sampleData = JSON.parse(readFileSync(fixturePath, 'utf8')) as SampleData;

// Approximate points for fictional fixtures, used only to exercise local-distance rules.
const sampleCoordinates: Record<string, [number, number]> = {
  '33308': [26.19, -80.115],
  '33027': [25.981, -80.365],
  '33131': [25.76, -80.19],
  '33137': [25.81, -80.19],
  '33161': [25.904, -80.178],
  '33432': [26.35, -80.083],
  '33019': [26.02, -80.115],
};

/** Adds the fictional saved-search examples once when the mock dataset is imported. */
export function seedMockSavedSearches(store: Store) {
  const existing = store.listSavedSearches();
  const seeded = sampleData.savedSearches.flatMap((area) => {
    const location = area.area.startsWith('Fort Lauderdale')
      ? 'Fort Lauderdale 33308'
      : area.area.startsWith('Miami')
        ? '33131'
        : 'North Miami 33161';
    const searches = [
      { name: `${area.area} · Buy`, mode: 'sale' as const, location },
      ...(area.rent ? [{ name: `${area.area} · Rent`, mode: 'rent' as const, location }] : []),
    ];
    return searches.map((search) => {
      const match = existing.find(
        (entry) => entry.name === search.name && entry.mode === search.mode,
      );
      return match ?? store.createSavedSearch({ ...search, filters: { status: 'active' } });
    });
  });

  for (const area of sampleData.savedSearches) {
    const buy = seeded.find((entry) => entry.name === `${area.area} · Buy`);
    const rent = seeded.find((entry) => entry.name === `${area.area} · Rent`);
    if (buy && rent && buy.pairedSearchId !== rent.id) store.pairSavedSearches(buy.id, rent.id);
  }
  return store.listSavedSearches();
}

export const mockProviderCapabilities: ProviderCapabilities = {
  photos: false,
  sourceUrl: false,
  waterfront: false,
  bathSplit: false,
  history: true,
  hoaFee: true,
  rentEstimates: false,
};

interface SyntheticRentCastListing {
  id: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  zipCode: string;
  county: string;
  latitude?: number | null;
  longitude?: number | null;
  propertyType: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  hoa?: { fee?: number | null };
  status: string;
  price: number;
  listedDate?: string;
  removedDate?: string;
  lastSeenDate?: string;
  mlsName?: string;
  mlsNumber?: string;
  listingAgent?: { name?: string; phone?: string; email?: string };
  listingOffice?: { name?: string; phone?: string; email?: string };
  history?: Record<string, { price?: number; status?: string }>;
}

interface SyntheticRentCastFixtures {
  sale: SyntheticRentCastListing[];
  rental: SyntheticRentCastListing[];
}

const rentCastFixturePath = fileURLToPath(
  new URL('../../../../fixtures/rentcast-synthetic-listings.json', import.meta.url),
);
const syntheticFixtures = JSON.parse(
  readFileSync(rentCastFixturePath, 'utf8'),
) as SyntheticRentCastFixtures;

function splitBaths(baths: number) {
  const full = Math.floor(baths);
  return { bathsTotal: baths, bathsFull: full, bathsHalf: Math.round((baths - full) * 2) };
}

function normalizeSyntheticUnit(value: string | null | undefined) {
  return value?.replace(/^(?:unit|apt\.?|apartment|#)\s*#?\s*/i, '').trim() || null;
}

function toProviderListing(
  property: SampleProperty,
  listing: SampleListing,
  sourceId: string,
  rawPayload: unknown,
): ProviderListing {
  const propertyInput: PropertyInput = {
    street: property.address,
    unit: property.unit,
    city: property.city,
    zip: property.zip,
    latitude: sampleCoordinates[property.zip]?.[0] ?? null,
    longitude: sampleCoordinates[property.zip]?.[1] ?? null,
    county: property.county,
    propertyType: property.type,
    floodZone: property.floodZone ?? null,
    riskDetails: {
      floodZoneSource: property.floodZone ? 'Sample data — not real listings' : null,
      floodZoneDate: property.floodZone ? sampleData.asOf : null,
      roofYear: property.roofYear ?? null,
      windMitigation: property.windMitigation ?? [],
      insuranceSource:
        property.roofYear || property.windMitigation?.length
          ? 'Sample data — not real listings'
          : null,
      insuranceDate: property.roofYear || property.windMitigation?.length ? sampleData.asOf : null,
      milestoneInspection: property.association?.milestoneInspection ?? null,
      countyRecertification: property.association?.countyRecertification ?? null,
      reserveStudy: property.association?.reserveStudy ?? null,
      specialAssessment: property.association?.specialAssessment ?? null,
      assessmentAmount: null,
      assessmentPaymentType: null,
      rentalRestrictions: property.association?.rentalRestrictions ?? null,
      approvalRestrictions: property.association?.approvalRestrictions ?? null,
      associationSource: property.association ? 'Sample data — not real listings' : null,
      associationDate: property.association ? sampleData.asOf : null,
    },
    beds: property.beds,
    ...splitBaths(property.baths),
    livingAreaSqft: property.livingAreaSqft,
    yearBuilt: property.yearBuilt,
    sample: true,
  };
  const normalizedListing: Omit<ListingInput, 'provider' | 'providerId'> = {
    mode: listing.mode,
    price: listing.price,
    pricePeriod: listing.mode === 'sale' ? 'total' : 'month',
    status: listing.status,
    providerListedDate: listing.listedOn ?? null,
    providerLastSeenDate: listing.lastSeen ?? null,
    sample: true,
  };
  return { sourceId, property: propertyInput, listing: normalizedListing, rawPayload };
}

/** Fixture-backed evidence keeps the sample Fort Lauderdale checklist representative. */
export function seedMockCostEntries(store: Store) {
  const first = sampleData.properties.find((property) => property.city === 'Fort Lauderdale');
  if (!first) return;
  const property = store.findPropertyByAddress({
    street: first.address,
    unit: first.unit,
    city: first.city,
    zip: first.zip,
  });
  if (!property || store.listCostEntries(property.id).length) return;
  store.addCostEntry(property.id, {
    kind: 'tax_bill',
    amount: 0,
    state: 'Doc',
    source: 'Sample tax bill · no CDD',
    date: '2026-10-05',
    assessmentStatus: null,
    paymentType: null,
    amountUnknown: false,
    sample: true,
  });
  store.addCostEntry(property.id, {
    kind: 'hoa_none',
    amount: null,
    state: 'N/A',
    source: 'Sample association confirmation',
    date: '2026-10-05',
    assessmentStatus: null,
    paymentType: null,
    amountUnknown: false,
    sample: true,
  });
  store.addCostEntry(property.id, {
    kind: 'homeowners_quote',
    amount: 610,
    state: 'Quote',
    source: 'Sample homeowners quote',
    date: '2026-10-05',
    assessmentStatus: null,
    paymentType: null,
    amountUnknown: false,
    sample: true,
  });
}

function records(): ProviderListing[] {
  const results = sampleData.properties.flatMap((property) =>
    property.listings.map((listing) =>
      toProviderListing(property, listing, `${property.id}:${listing.mode}`, { property, listing }),
    ),
  );

  for (const [subjectId, comps] of Object.entries(sampleData.rentComps ?? {})) {
    const subject = sampleData.properties.find((property) => property.id === subjectId);
    const [latitude, longitude] = sampleCoordinates[subject?.zip ?? ''] ?? [null, null];
    if (!subject || latitude === null || longitude === null) continue;
    for (const [index, comp] of comps.entries()) {
      const compLongitude =
        longitude - comp.distanceMi / (69 * Math.cos((latitude * Math.PI) / 180));
      results.push({
        sourceId: `sample-rent-comp:${subjectId}:${index + 1}`,
        property: {
          street: comp.address,
          city: subject.city,
          zip: subject.zip,
          county: subject.county,
          latitude,
          longitude: compLongitude,
          propertyType: subject.type,
          beds: comp.beds,
          livingAreaSqft: comp.sqft,
          sample: true,
        },
        listing: {
          mode: 'rent',
          price: comp.rent,
          pricePeriod: 'month',
          status: 'active',
          providerListedDate: comp.lastSeen,
          providerLastSeenDate: comp.lastSeen,
          sample: true,
        },
        rawPayload: { sampleComparableFor: subjectId, comp },
      });
    }
  }

  const incoming = sampleData.matchReview.incoming;
  const bayProperty: SampleProperty = {
    id: 'match-review-1500-bay-rd-unit-1204',
    address: incoming.address,
    unit: incoming.unit,
    city: incoming.city,
    zip: sampleData.matchReview.existing.zip ?? '33139',
    county: 'Miami-Dade',
    type: 'condo',
    beds: 2,
    baths: 2,
    livingAreaSqft: 1100,
    yearBuilt: 2000,
    listings: [],
  };
  results.push(
    toProviderListing(
      bayProperty,
      {
        mode: incoming.mode,
        price: incoming.price,
        status: 'active',
        lastSeen: incoming.seen,
        sample: true,
      },
      `${bayProperty.id}:rent`,
      { property: bayProperty, matchReview: sampleData.matchReview },
    ),
  );

  for (const [mode, listings] of [
    ['sale', syntheticFixtures.sale],
    ['rent', syntheticFixtures.rental],
  ] as const) {
    for (const record of listings) {
      const propertyType =
        record.propertyType === 'Single Family'
          ? 'single_family'
          : record.propertyType === 'Condo'
            ? 'condo'
            : record.propertyType === 'Townhouse'
              ? 'townhome'
              : 'other';
      const history = Object.entries(record.history ?? {}).map(([date, change]) => ({
        date,
        price: change.price ?? null,
        status: change.status ?? null,
      }));
      const hasUnknownType = propertyType === 'other';
      results.push({
        sourceId: `rentcast-synthetic:${record.id}`,
        property: {
          street: record.addressLine1,
          unit: normalizeSyntheticUnit(record.addressLine2),
          city: record.city,
          zip: record.zipCode,
          county: record.county,
          latitude: record.latitude ?? null,
          longitude: record.longitude ?? null,
          propertyType,
          beds: record.bedrooms ?? null,
          ...((record.bathrooms ?? null) === null
            ? { bathsTotal: null, bathsFull: null, bathsHalf: null }
            : splitBaths(record.bathrooms!)),
          livingAreaSqft: record.squareFootage ?? null,
          lotSizeSqft: record.lotSize ?? null,
          yearBuilt: record.yearBuilt ?? null,
          sample: true,
        },
        listing: {
          mode,
          price: record.price,
          pricePeriod: mode === 'sale' ? 'total' : 'month',
          status: record.status.toLocaleLowerCase('en-US'),
          hoaFee: record.hoa?.fee ?? null,
          mlsName: record.mlsName ?? null,
          mlsNumber: record.mlsNumber ?? null,
          agentName: record.listingAgent?.name ?? null,
          agentPhone: record.listingAgent?.phone ?? null,
          agentEmail: record.listingAgent?.email ?? null,
          officeName: record.listingOffice?.name ?? null,
          officePhone: record.listingOffice?.phone ?? null,
          officeEmail: record.listingOffice?.email ?? null,
          providerListedDate: record.listedDate ?? null,
          providerRemovedDate: record.removedDate ?? null,
          providerLastSeenDate: record.lastSeenDate ?? null,
          providerHistory: history,
          fieldQuality: hasUnknownType ? { propertyType: 'unknown provider value' } : {},
          sample: true,
        },
        rawPayload: record,
      });
    }
  }
  return results;
}

export class MockListingProvider implements ListingProvider {
  readonly name = 'mock';
  readonly pageSize = 500;
  readonly capabilities = mockProviderCapabilities;
  private readonly listings: ProviderListing[];

  constructor(listings = records()) {
    this.listings = listings;
  }

  async search(criteria: SearchCriteria, page: number) {
    const filtered = this.listings.filter((record) => {
      if (criteria.mode && record.listing.mode !== criteria.mode) return false;
      if (criteria.location) {
        const needle = criteria.location.toLocaleLowerCase('en-US');
        const haystack = `${record.property.city} ${record.property.zip}`.toLocaleLowerCase(
          'en-US',
        );
        if (!haystack.includes(needle)) return false;
      }
      const price = record.listing.price;
      if (criteria.priceMin != null && price != null && price < criteria.priceMin) return false;
      if (criteria.priceMax != null && price != null && price > criteria.priceMax) return false;
      if (criteria.beds != null && (record.property.beds ?? 0) < criteria.beds) return false;
      if (criteria.baths != null && (record.property.bathsTotal ?? 0) < criteria.baths)
        return false;
      if (criteria.propertyType && record.property.propertyType !== criteria.propertyType)
        return false;
      if (criteria.minSqft != null && (record.property.livingAreaSqft ?? 0) < criteria.minSqft)
        return false;
      if (criteria.statuses?.length && !criteria.statuses.includes(record.listing.status))
        return false;
      return true;
    });
    if (!Number.isInteger(page) || page < 1) throw new Error('Page must be a positive integer');
    const pageSize = 500;
    return filtered.slice((page - 1) * pageSize, page * pageSize);
  }

  async getListing(sourceId: string) {
    return this.listings.find((record) => record.sourceId === sourceId) ?? null;
  }
}
