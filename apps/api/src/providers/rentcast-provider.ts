import type { ProviderHistory } from '../store.js';
import type {
  ListingProvider,
  ProviderCapabilities,
  ProviderListing,
  SearchCriteria,
} from './listing-provider.js';

const API_ROOT = 'https://api.rentcast.io/v1/listings';
const PAGE_SIZE = 500;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type RentCastFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string> },
) => Promise<FetchResponse>;

interface RentCastListing {
  id?: unknown;
  formattedAddress?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  state?: unknown;
  zipCode?: unknown;
  county?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  propertyType?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  squareFootage?: unknown;
  lotSize?: unknown;
  yearBuilt?: unknown;
  hoa?: { fee?: unknown } | null;
  status?: unknown;
  price?: unknown;
  listedDate?: unknown;
  removedDate?: unknown;
  lastSeenDate?: unknown;
  mlsName?: unknown;
  mlsNumber?: unknown;
  listingAgent?: { name?: unknown; phone?: unknown; email?: unknown } | null;
  listingOffice?: { name?: unknown; phone?: unknown; email?: unknown } | null;
  history?: unknown;
}

export const rentCastCapabilities: ProviderCapabilities = {
  photos: false,
  sourceUrl: false,
  waterfront: false,
  bathSplit: false,
  history: true,
  hoaFee: true,
  rentEstimates: true,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeUnit(value: unknown) {
  return (
    text(value)
      ?.replace(/^(?:unit|apt\.?|apartment|#)\s*#?\s*/i, '')
      .trim() || null
  );
}

function normalizePropertyType(value: unknown) {
  const source = text(value);
  const key = source?.toLocaleLowerCase('en-US');
  const known: Record<string, string> = {
    'single family': 'single_family',
    condo: 'condo',
    townhouse: 'townhome',
    townhome: 'townhome',
    manufactured: 'manufactured',
    'multi-family': 'multi_family',
    apartment: 'apartment',
    land: 'land',
  };
  const propertyType = key ? known[key] : undefined;
  return {
    propertyType: propertyType ?? 'other',
    quality: propertyType ? null : `unknown provider value${source ? `: ${source}` : ''}`,
  };
}

function normalizeStatus(value: unknown): string | null {
  return text(value)?.toLocaleLowerCase('en-US') ?? null;
}

function historyEntries(value: unknown): ProviderHistory[] {
  const history = asRecord(value);
  if (!history) return [];
  return Object.entries(history)
    .map(([date, entry]) => {
      const row = asRecord(entry);
      return {
        date,
        price: number(row?.price),
        status: normalizeStatus(row?.status),
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function toProviderListing(mode: 'sale' | 'rent', value: unknown): ProviderListing {
  const record = asRecord(value) as RentCastListing | null;
  if (!record) throw new Error('RentCast returned a listing with an invalid shape.');
  const id = text(record.id);
  if (!id) throw new Error('RentCast returned a listing without an ID.');

  const formattedAddress = text(record.formattedAddress);
  const addressParts = formattedAddress?.split(',').map((part) => part.trim()) ?? [];
  const addressLine1 = text(record.addressLine1) ?? addressParts[0] ?? null;
  const fallbackUnit =
    addressParts.length >= 4 && /^(?:unit|apt\.?|apartment|#)/i.test(addressParts[1] ?? '')
      ? addressParts[1]
      : null;
  const city = text(record.city) ?? addressParts.at(-2) ?? null;
  const formattedZip = addressParts.at(-1)?.match(/\b\d{5}\b/)?.[0] ?? null;
  const zip = text(record.zipCode) ?? formattedZip;
  if (!addressLine1) throw new Error('RentCast returned a listing without a usable address.');
  const addressQuality: Record<string, string> = {};
  if (!city) addressQuality.city = 'missing';
  if (!zip) addressQuality.zip = 'missing';
  const { propertyType, quality: propertyTypeQuality } = normalizePropertyType(record.propertyType);
  const fieldQuality: Record<string, string> = { ...addressQuality };
  if (propertyTypeQuality) fieldQuality.propertyType = propertyTypeQuality;

  const sourceId = `${mode}:${id}`;
  const hoa = asRecord(record.hoa);
  const agent = asRecord(record.listingAgent);
  const office = asRecord(record.listingOffice);

  return {
    sourceId,
    property: {
      street: addressLine1,
      unit: normalizeUnit(record.addressLine2 ?? fallbackUnit),
      city: city ?? '',
      zip: zip ?? '',
      county: text(record.county),
      latitude: number(record.latitude),
      longitude: number(record.longitude),
      propertyType,
      beds: number(record.bedrooms),
      bathsTotal: number(record.bathrooms),
      livingAreaSqft: number(record.squareFootage),
      lotSizeSqft: number(record.lotSize),
      yearBuilt: number(record.yearBuilt),
    },
    listing: {
      mode,
      price: number(record.price),
      pricePeriod: mode === 'sale' ? 'total' : 'month',
      status: normalizeStatus(record.status) ?? 'unknown',
      hoaFee: number(hoa?.fee),
      mlsName: text(record.mlsName),
      mlsNumber: text(record.mlsNumber),
      agentName: text(agent?.name),
      agentPhone: text(agent?.phone),
      agentEmail: text(agent?.email),
      officeName: text(office?.name),
      officePhone: text(office?.phone),
      officeEmail: text(office?.email),
      providerListedDate: text(record.listedDate),
      providerRemovedDate: text(record.removedDate),
      providerLastSeenDate: text(record.lastSeenDate),
      providerHistory: historyEntries(record.history),
      fieldQuality,
    },
    rawPayload: value,
  };
}

function range(min: number | null | undefined, max: number | null | undefined) {
  if (min == null && max == null) return null;
  return `${min ?? '*'}:${max ?? '*'}`;
}

function addLocationParams(params: URLSearchParams, location: string | undefined) {
  const value = location?.trim();
  if (!value) throw new Error('Enter a city or ZIP code before refreshing with RentCast.');

  if (/^\d{5}$/.test(value)) {
    params.set('zipCode', value);
    return;
  }

  const zipOrRange = value.match(/^(.*?)(?:\s+|,\s*)(\d{5})(?:\s*([-–])\s*\d{5})?\s*$/);
  if (zipOrRange?.[2] && !zipOrRange[3]) {
    params.set('zipCode', zipOrRange[2]);
    return;
  }
  const withoutZip = zipOrRange?.[1]?.trim() ?? value;
  const cityAndState = withoutZip.match(/^(.*?)(?:,\s*([A-Za-z]{2}|Florida))?$/);
  const city = cityAndState?.[1]?.trim();
  if (!city) throw new Error('Enter a city or ZIP code before refreshing with RentCast.');
  params.set('city', city);
  const state = cityAndState?.[2]?.toLocaleUpperCase('en-US');
  params.set('state', state === 'FLORIDA' || !state ? 'FL' : state);
}

function addCriteriaParams(params: URLSearchParams, criteria: SearchCriteria) {
  addLocationParams(params, criteria.location);
  const price = range(criteria.priceMin, criteria.priceMax);
  if (price) params.set('price', price);
  if (criteria.beds != null) params.set('bedrooms', String(criteria.beds));
  if (criteria.baths != null) params.set('bathrooms', String(criteria.baths));
  if (criteria.minSqft != null) params.set('squareFootage', `${criteria.minSqft}:*`);

  const types: Record<string, string> = {
    single_family: 'Single Family',
    house: 'Single Family',
    condo: 'Condo',
    townhome: 'Townhouse',
    townhouse: 'Townhouse',
    manufactured: 'Manufactured',
    multi_family: 'Multi-Family',
    apartment: 'Apartment',
  };
  const propertyType = criteria.propertyType
    ? types[criteria.propertyType.toLocaleLowerCase('en-US')]
    : undefined;
  if (propertyType) params.set('propertyType', propertyType);

  if (criteria.statuses?.length) {
    const statuses = criteria.statuses.map((status) => status.toLocaleLowerCase('en-US'));
    const hasActive = statuses.includes('active');
    const hasInactive = statuses.some((status) => status !== 'active');
    if (hasActive !== hasInactive) params.set('status', hasActive ? 'Active' : 'Inactive');
  } else {
    params.set('status', 'Active');
  }
}

export class RentCastListingProvider implements ListingProvider {
  readonly name = 'RentCast';
  readonly pageSize = PAGE_SIZE;
  readonly capabilities = rentCastCapabilities;

  constructor(
    private readonly getApiKey: () => string | null,
    private readonly fetcher: RentCastFetch = globalThis.fetch.bind(globalThis),
  ) {}

  private async request(url: string, missingIsNull = false): Promise<unknown | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('No RentCast key set');
    const response = await this.fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
    });
    if (missingIsNull && response.status === 404) return null;
    if (!response.ok) throw new Error(`RentCast request failed with HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error('RentCast returned invalid JSON.');
    }
  }

  async search(criteria: SearchCriteria, page: number): Promise<ProviderListing[]> {
    if (!Number.isInteger(page) || page < 1) throw new Error('Page must be a positive integer');
    const mode = criteria.mode ?? 'sale';
    const endpoint = mode === 'sale' ? 'sale' : 'rental/long-term';
    const params = new URLSearchParams();
    addCriteriaParams(params, criteria);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    const response = await this.request(`${API_ROOT}/${endpoint}?${params.toString()}`);
    if (!Array.isArray(response)) throw new Error('RentCast returned an invalid listing page.');
    return response.map((row) => toProviderListing(mode, row));
  }

  async getListing(sourceId: string): Promise<ProviderListing | null> {
    const match = sourceId.match(/^(sale|rent):(.+)$/);
    if (!match) throw new Error('RentCast source ID must include a listing mode.');
    const [, mode, id] = match as [string, 'sale' | 'rent', string];
    const endpoint = mode === 'sale' ? 'sale' : 'rental/long-term';
    const encodedId = encodeURIComponent(id);
    const response = await this.request(`${API_ROOT}/${endpoint}/${encodedId}`, true);
    return response == null ? null : toProviderListing(mode, response);
  }
}
