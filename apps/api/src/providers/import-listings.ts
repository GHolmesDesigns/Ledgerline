import type { ListingProvider, ProviderListing } from './listing-provider.js';
import { normalizeAddress } from './normalize-address.js';
import type { Property, Store } from '../store.js';

export interface ImportResult {
  provider: string;
  properties: number;
  listings: number;
  snapshots: number;
}

function addressKey(record: ProviderListing['property']) {
  return JSON.stringify(normalizeAddress(record));
}

export async function importProviderListings(
  provider: ListingProvider,
  store: Store,
): Promise<ImportResult> {
  const records: ProviderListing[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await provider.search({}, page);
    if (batch.length === 0) break;
    records.push(...batch);
  }

  const imported = store.transaction(() => {
    const knownProperties = new Map<string, Property>();
    for (const property of store.listProperties())
      knownProperties.set(addressKey(property), property);

    let createdProperties = 0;
    let snapshots = 0;
    for (const record of records) {
      const key = addressKey(record.property);
      let property = knownProperties.get(key);
      if (!property) {
        property = store.createProperty({ ...record.property, sample: true });
        knownProperties.set(key, property);
        createdProperties += 1;
      }

      const listing = store.upsertListing(property.id, {
        ...record.listing,
        provider: provider.name,
        providerId: record.sourceId,
        sample: true,
      });
      store.addSnapshot(listing.id, { price: listing.price, status: listing.status });
      store.addRawPayload(listing.id, record.rawPayload);
      snapshots += 1;
    }
    return { createdProperties, snapshots };
  });

  return {
    provider: provider.name,
    properties: imported.createdProperties,
    listings: records.length,
    snapshots: imported.snapshots,
  };
}
