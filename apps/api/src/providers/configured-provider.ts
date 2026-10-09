import type { ProviderCredentials } from '../provider-credentials.js';
import { MockListingProvider } from './mock-provider.js';
import { RentCastListingProvider, type RentCastFetch } from './rentcast-provider.js';
import type { ListingProvider } from './listing-provider.js';

export function createConfiguredListingProvider(
  credentials: ProviderCredentials,
  fetcher?: RentCastFetch,
): ListingProvider {
  return credentials.getListingProvider() === 'rentcast'
    ? new RentCastListingProvider(() => credentials.getRentCastKey(), fetcher)
    : new MockListingProvider();
}
