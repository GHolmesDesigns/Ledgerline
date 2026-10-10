import type { ListingInput, PropertyInput } from '../store.js';

export interface SearchCriteria {
  mode?: 'sale' | 'rent';
  location?: string;
  priceMin?: number | null;
  priceMax?: number | null;
  beds?: number;
  baths?: number;
  propertyType?: string;
  minSqft?: number;
  statuses?: string[];
}

export interface ProviderCapabilities {
  photos: boolean;
  sourceUrl: boolean;
  waterfront: boolean;
  bathSplit: boolean;
  history: boolean;
  hoaFee: boolean;
  rentEstimates: boolean;
  /** True only after a real provider radius request has been verified. */
  radiusSearch?: boolean;
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

export interface RentEstimateResult {
  value: number;
  low: number;
  high: number;
  comps: Array<{ id: string; address: string; rent: number; distanceMi: number | null }>;
}

export interface ListingProvider {
  readonly name: string;
  /** When known, a short page signals that the provider has no more results. */
  readonly pageSize?: number;
  readonly capabilities: ProviderCapabilities;
  search(criteria: SearchCriteria, page: number): Promise<ProviderListing[]>;
  getListing(sourceId: string): Promise<ProviderListing | null>;
  estimateRent?(property: RentEstimateRequest): Promise<RentEstimateResult>;
}
