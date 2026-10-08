import { closeDatabase, openDatabase } from '../src/database.js';
import { importProviderListings } from '../src/providers/import-listings.js';
import { MockListingProvider, seedMockSavedSearches } from '../src/providers/mock-provider.js';
import { createStore } from '../src/store.js';

// Seeds LEDGERLINE_DATA_PATH for browser tests: the sample listings and saved searches,
// plus an existing "1500 Bay Rd" with no unit, so the Unit 1204 listing waits in the
// property match review queue.
const database = await openDatabase();
try {
  const store = createStore(database);
  store.createProperty({ street: '1500 Bay Rd', city: 'Miami Beach', zip: '33139', sample: true });
  await importProviderListings(new MockListingProvider(), store);
  seedMockSavedSearches(store);
} finally {
  closeDatabase(database);
}
