import type { Database } from 'sql.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase, persistDatabase } from '../database.js';
import { createStore, type Store } from '../store.js';
import { importProviderListings } from './import-listings.js';
import { normalizeAddress } from './normalize-address.js';
import { MockListingProvider, seedMockSavedSearches } from './mock-provider.js';
import type { ListingProvider, ProviderListing } from './listing-provider.js';

const directories: string[] = [];
let database: Database;
let store: Store;
let tick: number;

function fixedProvider(record: ProviderListing): ListingProvider {
  return {
    name: 'fixed',
    capabilities: {
      photos: false,
      sourceUrl: false,
      waterfront: false,
      bathSplit: false,
      history: false,
      hoaFee: false,
      rentEstimates: false,
    },
    async search(_criteria, page) {
      return page === 1 ? [record] : [];
    },
    async getListing() {
      return record;
    },
  };
}

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-import-'));
  directories.push(directory);
  database = await openDatabase(join(directory, 'ledgerline.sqlite'));
  tick = 0;
  store = createStore(database, {
    clock: () => new Date(Date.UTC(2026, 9, 8, 12, tick++)),
    afterWrite: () => persistDatabase(database),
  });
});

afterEach(() => {
  try {
    closeDatabase(database);
  } catch {
    // Already closed by the test.
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('address normalization', () => {
  it('matches suffix abbreviations, case, punctuation, and unit designators', () => {
    assert.deepEqual(
      normalizeAddress({ street: '2207 NE 32nd Court', city: 'Fort Lauderdale', zip: '33308' }),
      normalizeAddress({ street: '2207 ne 32nd ct.', city: 'FORT LAUDERDALE', zip: '33308' }),
    );
    assert.deepEqual(
      normalizeAddress({
        street: '1500 Bay Road, Apartment #1204',
        city: 'Miami Beach',
        zip: '33139',
      }),
      normalizeAddress({
        street: '1500 Bay Rd',
        unit: 'Unit 1204',
        city: 'Miami Beach',
        zip: '33139',
      }),
    );
  });
});

describe('mock provider import', () => {
  it('queues a missing-unit address instead of merging or creating a property', async () => {
    const existing = store.createProperty({
      street: '1500 Bay Rd',
      city: 'Miami Beach',
      zip: '33139',
      sample: true,
    });
    const note = store.addNote(existing.id, 'Check the building documents');
    await importProviderListings(new MockListingProvider(), store);
    const review = store
      .listPendingMatchReviews()
      .find((entry) => entry.candidatePropertyId === existing.id);
    assert.ok(review);
    assert.equal(review.reason, 'same street address; unit missing on existing record');
    assert.equal(review.candidatePropertyId, existing.id);
    assert.equal(store.listNotes(existing.id)[0]?.id, note.id);
    assert.equal(store.listListings(existing.id).length, 0);
    assert.equal(
      store.findPropertyByAddress({
        street: '1500 Bay Rd',
        unit: '1204',
        city: 'Miami Beach',
        zip: '33139',
      }),
      null,
    );
  });

  it('links the incoming listing to the existing property and Undo removes only that listing', async () => {
    const existing = store.createProperty({
      street: '1500 Bay Rd',
      city: 'Miami Beach',
      zip: '33139',
      sample: true,
    });
    store.addNote(existing.id, 'Keep this note');
    await importProviderListings(new MockListingProvider(), store);
    const review = store
      .listPendingMatchReviews()
      .find((entry) => entry.candidatePropertyId === existing.id);
    assert.ok(review);
    store.decideMatchReview(review.id, 'link');
    assert.equal(store.listListings(existing.id).length, 1);
    assert.equal(store.listNotes(existing.id)[0]?.body, 'Keep this note');
    store.undoMatchReview(review.id);
    assert.equal(store.listListings(existing.id).length, 0);
    assert.equal(store.listNotes(existing.id)[0]?.body, 'Keep this note');
    assert.equal(
      store.listPendingMatchReviews().filter((entry) => entry.candidatePropertyId === existing.id)
        .length,
      1,
    );
  });

  it('keeps the incoming unit separate and Undo removes the property it created', async () => {
    const existing = store.createProperty({
      street: '1500 Bay Rd',
      city: 'Miami Beach',
      zip: '33139',
      sample: true,
    });
    store.addNote(existing.id, 'Keep this note');
    await importProviderListings(new MockListingProvider(), store);
    const review = store
      .listPendingMatchReviews()
      .find((entry) => entry.candidatePropertyId === existing.id);
    assert.ok(review);
    const decided = store.decideMatchReview(review.id, 'keep_separate');
    assert.ok(decided.createdPropertyId);
    assert.equal(store.listListings(decided.createdPropertyId!).length, 1);
    assert.equal(store.listNotes(existing.id)[0]?.body, 'Keep this note');
    store.undoMatchReview(review.id);
    assert.equal(store.getProperty(decided.createdPropertyId!), null);
    assert.equal(store.listNotes(existing.id)[0]?.body, 'Keep this note');
    assert.equal(
      store.listPendingMatchReviews().filter((entry) => entry.candidatePropertyId === existing.id)
        .length,
      1,
    );
  });

  it('imports an exact address-and-unit match without adding a review', async () => {
    const property = store.createProperty({
      street: '1500 Bay Rd',
      unit: '1204',
      city: 'Miami Beach',
      zip: '33139',
      sample: true,
    });
    await importProviderListings(new MockListingProvider(), store);
    assert.equal(
      store.listPendingMatchReviews().filter((entry) => entry.candidatePropertyId === property.id)
        .length,
      0,
    );
    assert.equal(store.listListings(property.id).length, 1);
  });

  it('queues a different unit on the same street address', async () => {
    const candidate = store.createProperty({
      street: '1500 Bay Rd',
      unit: '1203',
      city: 'Miami Beach',
      zip: '33139',
    });
    await importProviderListings(
      fixedProvider({
        sourceId: 'different-unit',
        property: { street: '1500 Bay Road', unit: '1204', city: 'Miami Beach', zip: '33139' },
        listing: { mode: 'rent', price: 3400, pricePeriod: 'month', status: 'active' },
        rawPayload: {},
      }),
      store,
    );
    const [review] = store.listPendingMatchReviews();
    assert.ok(review);
    assert.equal(review.reason, 'same street address; unit differs');
    assert.equal(review.candidatePropertyId, candidate.id);
    assert.equal(store.listProperties().length, 1);
  });

  it('queues nearby coordinates only when the configurable distance is enabled', async () => {
    const candidate = store.createProperty({
      street: '20 Palm Ave',
      city: 'Miami Beach',
      zip: '33139',
      latitude: 25.78,
      longitude: -80.13,
    });
    const provider = fixedProvider({
      sourceId: 'nearby-home',
      property: {
        street: '22 Palm Ave',
        city: 'Miami Beach',
        zip: '33139',
        latitude: 25.7801,
        longitude: -80.13,
      },
      listing: { mode: 'sale', price: 500000, pricePeriod: 'total', status: 'active' },
      rawPayload: {},
    });
    await importProviderListings(provider, store, { nearbyMatchDistanceMeters: 50 });
    const [review] = store.listPendingMatchReviews();
    assert.ok(review);
    assert.match(review.reason, /^nearby coordinates; \d+ m apart$/);
    assert.equal(review.candidatePropertyId, candidate.id);
    assert.equal(store.listProperties().length, 1);
  });

  it('loads the Fort Lauderdale sale and rent listings under one property', async () => {
    await importProviderListings(new MockListingProvider(), store);
    const property = store.findPropertyByAddress({
      street: '2207 NE 32nd Ct',
      city: 'Fort Lauderdale',
      zip: '33308',
    });
    assert.ok(property);
    const listings = store.listListings(property.id);
    assert.deepEqual(listings.map(({ mode, price }) => [mode, price]).sort(), [
      ['rent', 5200],
      ['sale', 849000],
    ]);
    assert.ok(listings.every((listing) => listing.sample));
    assert.equal(store.listProperties().filter((entry) => entry.zip === '33308').length, 1);
  });

  it('is idempotent for properties and listings while recording one snapshot per run', async () => {
    const provider = new MockListingProvider();
    const first = await importProviderListings(provider, store);
    const second = await importProviderListings(provider, store);
    assert.equal(first.listings, second.listings);
    assert.equal(second.properties, 0);
    assert.equal(store.listProperties().length, first.properties);
    const properties = store.listProperties();
    const listings = properties.flatMap((property) => store.listListings(property.id));
    assert.equal(listings.length, first.snapshots);
    assert.ok(listings.every((listing) => listing.sample));
    assert.ok(listings.every((listing) => store.listSnapshots(listing.id).length === 2));
    assert.ok(listings.every((listing) => store.listRawPayloads(listing.id).length === 2));
  });

  it('serves and imports the synthetic RentCast shaped Miami-Dade and Broward fixture listings', async () => {
    const provider = new MockListingProvider();
    const firstPage = await provider.search({}, 1);
    const synthetic = firstPage.filter((record) =>
      record.sourceId.startsWith('rentcast-synthetic:'),
    );
    assert.equal(synthetic.length, 33);
    assert.ok(synthetic.some((record) => record.sourceId.endsWith('md-dual-sale')));
    assert.ok(synthetic.some((record) => record.sourceId.endsWith('br-older-condo-sale')));
    assert.ok(synthetic.every((record) => record.property.sample && record.listing.sample));

    const imported = await importProviderListings(provider, store);
    assert.ok(imported.listings >= synthetic.length);
    const dualHome = store.findPropertyByAddress({
      street: '101 Fictional Bay Way',
      city: 'Miami',
      zip: '00000',
    });
    assert.ok(dualHome);
    assert.deepEqual(
      store
        .listListings(dualHome.id)
        .map(({ mode }) => mode)
        .sort(),
      ['rent', 'sale'],
    );
    const highrise = synthetic.find((record) => record.sourceId.endsWith('md-highrise-sale'));
    assert.ok(highrise);
    const highriseProperty = store.findPropertyByAddress({
      street: highrise.property.street,
      unit: highrise.property.unit,
      city: highrise.property.city,
      zip: highrise.property.zip,
    });
    assert.ok(highriseProperty);
    const [highriseListing] = store.listListings(highriseProperty.id);
    assert.equal(highriseListing.hoaFee, 1180);
    assert.equal(highriseListing.providerHistory.length, 4);
    assert.deepEqual(store.listRawPayloads(highriseListing.id)[0]?.payload, {
      id: 'md-highrise-sale',
      formattedAddress: '2200 Imaginary Ocean Drive, Unit 1804, Miami Beach, FL 00000',
      addressLine1: '2200 Imaginary Ocean Drive',
      addressLine2: 'Unit 1804',
      city: 'Miami Beach',
      state: 'FL',
      zipCode: '00000',
      county: 'Miami-Dade',
      latitude: null,
      longitude: null,
      propertyType: 'Condo',
      bedrooms: 2,
      bathrooms: 2.5,
      squareFootage: 1420,
      yearBuilt: 2008,
      hoa: { fee: 1180 },
      status: 'Active',
      price: 785000,
      listedDate: '2026-09-20T00:00:00.000Z',
      lastSeenDate: '2026-10-07T12:00:00.000Z',
      mlsName: 'SyntheticMLS',
      mlsNumber: 'SYN-MD-002',
      listingAgent: { name: 'Fictional Agent B', email: 'b@example.invalid' },
      listingOffice: { name: 'Invented Realty', phone: '5550100002' },
      history: {
        '2026-09-10': { event: 'Sale Listing', price: 825000 },
        '2026-09-20': { event: 'Sale Listing', price: 785000 },
        '2026-10-01': { event: 'Status Change', status: 'Pending', price: 785000 },
        '2026-10-04': { event: 'Status Change', status: 'Active', price: 785000 },
      },
    });
  });

  it('declares that the mock provider supplies no photos or source URLs', () => {
    const provider = new MockListingProvider();
    assert.equal(provider.capabilities.photos, false);
    assert.equal(provider.capabilities.sourceUrl, false);
  });

  it('seeds the three fixture search areas as Buy/Rent pairs, with North Miami Buy only', () => {
    const first = seedMockSavedSearches(store);
    assert.equal(first.length, 5);
    const fortLauderdale = first.find((search) => search.name.includes('Fort Lauderdale'));
    assert.ok(fortLauderdale?.pairedSearchId);
    const miamiBuy = first.find(
      (search) => search.name.includes('Miami 33131') && search.mode === 'sale',
    );
    assert.ok(miamiBuy?.pairedSearchId);
    const northMiami = first.find((search) => search.name.includes('North Miami'));
    assert.ok(northMiami);
    assert.equal(northMiami.mode, 'sale');
    assert.equal(northMiami.pairedSearchId, null);
    assert.equal(seedMockSavedSearches(store).length, 5);
  });

  it('keeps the match-review fixture records with the mock Bay Road listing for C7', async () => {
    await importProviderListings(new MockListingProvider(), store);
    const bayProperty = store.findPropertyByAddress({
      street: '1500 Bay Rd',
      unit: '1204',
      city: 'Miami Beach',
      zip: '33139',
    });
    assert.ok(bayProperty);
    const [listing] = store.listListings(bayProperty.id);
    assert.equal(listing.mode, 'rent');
    assert.deepEqual(store.listRawPayloads(listing.id)[0]?.payload, {
      property: {
        id: 'match-review-1500-bay-rd-unit-1204',
        address: '1500 Bay Rd',
        unit: '1204',
        city: 'Miami Beach',
        zip: '33139',
        county: 'Miami-Dade',
        type: 'condo',
        beds: 2,
        baths: 2,
        livingAreaSqft: 1100,
        yearBuilt: 2000,
        listings: [],
      },
      matchReview: {
        incoming: {
          address: '1500 Bay Rd',
          unit: '1204',
          city: 'Miami Beach',
          mode: 'rent',
          price: 3400,
          seen: '2026-10-06',
        },
        existing: {
          address: '1500 Bay Rd',
          unit: null,
          notes: 1,
        },
        reason: 'same street address; unit missing on existing record',
      },
    });
  });
});
