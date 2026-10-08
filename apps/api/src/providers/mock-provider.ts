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
  listings: SampleListing[];
}

interface SampleData {
  properties: SampleProperty[];
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
  history: false,
  hoaFee: false,
  rentEstimates: false,
};

function splitBaths(baths: number) {
  const full = Math.floor(baths);
  return { bathsTotal: baths, bathsFull: full, bathsHalf: Math.round((baths - full) * 2) };
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
    county: property.county,
    propertyType: property.type,
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

function records(): ProviderListing[] {
  const results = sampleData.properties.flatMap((property) =>
    property.listings.map((listing) =>
      toProviderListing(property, listing, `${property.id}:${listing.mode}`, { property, listing }),
    ),
  );

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
