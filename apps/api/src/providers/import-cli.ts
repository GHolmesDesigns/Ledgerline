import { closeDatabase, openDatabase } from '../database.js';
import { createStore } from '../store.js';
import { importProviderListings } from './import-listings.js';
import { MockListingProvider } from './mock-provider.js';

const database = await openDatabase();
try {
  const store = createStore(database);
  const result = await importProviderListings(new MockListingProvider(), store);
  console.log(
    `Imported ${result.listings} sample listings across ${result.properties} new properties.`,
  );
} finally {
  closeDatabase(database);
}
