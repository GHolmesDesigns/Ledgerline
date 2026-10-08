import type { ListingInput, PropertyInput } from '../store.js';

export interface SearchCriteria {
  mode?: 'sale' | 'rent';
  location?: string;
}

export interface ProviderCapabilities {
  photos: boolean;
  sourceUrl: boolean;
  waterfront: boolean;
  bathSplit: boolean;
  history: boolean;
  hoaFee: boolean;
  rentEstimates: boolean;
}

export interface ProviderListing {
  sourceId: string;
  property: PropertyInput;
  listing: Omit<ListingInput, 'provider' | 'providerId'>;
  rawPayload: unknown;
}

export interface RentEstimateRequest {
  property: PropertyInput;
}

export interface ListingProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  search(criteria: SearchCriteria, page: number): Promise<ProviderListing[]>;
  getListing(sourceId: string): Promise<ProviderListing | null>;
  estimateRent?(property: RentEstimateRequest): Promise<{ low: number; high: number }>;
}
