import type { ListingProvider, ProviderListing } from './listing-provider.js';
import { normalizeAddress } from './normalize-address.js';
import type { Property, ReviewListingInput, Store } from '../store.js';

export interface ImportResult {
  provider: string;
  properties: number;
  listings: number;
  snapshots: number;
}

function addressKey(record: ProviderListing['property']) {
  return JSON.stringify(normalizeAddress(record));
}

function distanceMeters(first: ProviderListing['property'], second: Property) {
  if (
    first.latitude == null ||
    first.longitude == null ||
    second.latitude == null ||
    second.longitude == null
  )
    return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(second.latitude - first.latitude);
  const dLon = radians(second.longitude - first.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ambiguityReason(incoming: ProviderListing['property'], existing: Property) {
  if (incoming.unit && !existing.unit)
    return 'same street address; unit missing on existing record';
  if (!incoming.unit && existing.unit)
    return 'same street address; unit missing on incoming record';
  return 'same street address; unit differs';
}

export async function importProviderListings(
  provider: ListingProvider,
  store: Store,
  options: { nearbyMatchDistanceMeters?: number } = {},
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
      const reviewed = store.findMatchReview(provider.name, record.sourceId);
      if (reviewed) {
        if (!reviewed.decision) continue;
        const destination =
          reviewed.decision === 'link' ? reviewed.candidatePropertyId : reviewed.createdPropertyId;
        if (!destination) continue;
        const listing = store.upsertListing(destination, {
          ...record.listing,
          provider: provider.name,
          providerId: record.sourceId,
          sample: true,
        });
        store.addSnapshot(listing.id, { price: listing.price, status: listing.status });
        store.addRawPayload(listing.id, record.rawPayload);
        snapshots += 1;
        continue;
      }
      const key = addressKey(record.property);
      let property = knownProperties.get(key);
      if (!property) {
        const normalizedIncoming = normalizeAddress(record.property);
        const streetCandidates = store.listProperties().filter((existing) => {
          const normalizedExisting = normalizeAddress(existing);
          return (
            normalizedExisting.street === normalizedIncoming.street &&
            normalizedExisting.city === normalizedIncoming.city &&
            normalizedExisting.zip === normalizedIncoming.zip
          );
        });
        let candidate = streetCandidates.find((entry) => entry.unit !== normalizedIncoming.unit);
        let reason = candidate ? ambiguityReason(normalizedIncoming, candidate) : '';
        if (!candidate && options.nearbyMatchDistanceMeters != null) {
          const nearby = store
            .listProperties()
            .map((entry) => ({ entry, distance: distanceMeters(record.property, entry) }))
            .filter(
              (entry) =>
                entry.distance != null && entry.distance <= options.nearbyMatchDistanceMeters!,
            )
            .sort((left, right) => left.distance! - right.distance!)[0];
          if (nearby) {
            candidate = nearby.entry;
            reason = `nearby coordinates; ${Math.round(nearby.distance!)} m apart`;
          }
        }
        if (candidate) {
          const incoming: ReviewListingInput & { provider: string } = {
            provider: provider.name,
            sourceId: record.sourceId,
            property: { ...record.property, sample: true },
            listing: { ...record.listing, sample: true },
            rawPayload: record.rawPayload,
          };
          store.enqueueMatchReview({
            incomingListing: incoming,
            candidatePropertyId: candidate.id,
            reason,
          });
          continue;
        }
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
