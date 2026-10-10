import type { Database, SqlValue } from 'sql.js';
import { randomUUID } from 'node:crypto';
import { defaultRankingWeights, type RankingWeights } from './ranking-weights.js';

// Data-access module for the core records (C5). Everything the API and web client
// know about properties, listings, and personal data goes through here, so no SQL
// lives anywhere else. Field names follow the normalized model, never a provider's.

export type ListingMode = 'sale' | 'rent';
export type PricePeriod = 'total' | 'month' | 'week' | 'year';

export interface PropertyRiskDetails {
  floodZoneSource: string | null;
  floodZoneDate: string | null;
  roofYear: number | null;
  windMitigation: string[];
  insuranceSource: string | null;
  insuranceDate: string | null;
  milestoneInspection: string | null;
  countyRecertification: string | null;
  reserveStudy: string | null;
  specialAssessment: string | null;
  assessmentAmount: number | null;
  assessmentPaymentType: 'one_time' | 'installments' | null;
  rentalRestrictions: string | null;
  approvalRestrictions: string | null;
  associationSource: string | null;
  associationDate: string | null;
}

export const emptyRiskDetails: PropertyRiskDetails = {
  floodZoneSource: null,
  floodZoneDate: null,
  roofYear: null,
  windMitigation: [],
  insuranceSource: null,
  insuranceDate: null,
  milestoneInspection: null,
  countyRecertification: null,
  reserveStudy: null,
  specialAssessment: null,
  assessmentAmount: null,
  assessmentPaymentType: null,
  rentalRestrictions: null,
  approvalRestrictions: null,
  associationSource: null,
  associationDate: null,
};

export interface PropertyInput {
  street: string;
  unit?: string | null;
  city: string;
  zip: string;
  county?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  propertyType?: string | null;
  floodZone?: string | null;
  riskDetails?: PropertyRiskDetails;
  beds?: number | null;
  bathsTotal?: number | null;
  bathsFull?: number | null;
  bathsHalf?: number | null;
  livingAreaSqft?: number | null;
  lotSizeSqft?: number | null;
  yearBuilt?: number | null;
  parcelId?: string | null;
  sample?: boolean;
}

export interface Property extends Required<PropertyInput> {
  id: string;
  valueOverrides?: Record<string, PropertyValueOverride>;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyPhoto {
  id: string;
  propertyId: string;
  path: string;
  source: string;
  dateAdded: string;
  order: number;
}

export interface PersonalTag {
  name: string;
  dateAdded?: string;
}

export const standardPersonalTags = [
  'Pool',
  'Pet friendly',
  'Waterfront',
  'Water view',
  'Garage',
  'Fenced yard',
  'Gated community',
  'In-unit washer/dryer',
  'Elevator',
  'Balcony',
  'Needs work',
] as const;

const normalizedTagName = (name: string) => name.trim().toLocaleLowerCase('en-US');

export interface ListingInput {
  provider: string;
  providerId: string;
  mlsName?: string | null;
  mlsNumber?: string | null;
  mode: ListingMode;
  price?: number | null;
  pricePeriod: PricePeriod;
  status: string;
  hoaFee?: number | null;
  imageUrls?: string[];
  sourceUrl?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  officeName?: string | null;
  officePhone?: string | null;
  officeEmail?: string | null;
  providerListedDate?: string | null;
  providerRemovedDate?: string | null;
  providerLastSeenDate?: string | null;
  /** Per-field quality flags, for example { hoaFee: 'missing' }. */
  fieldQuality?: Record<string, string>;
  implausibleFlags?: ImplausibleFlag[];
  providerHistory?: ProviderHistory[];
  sample?: boolean;
}

export interface ImplausibleFlag {
  field: string;
  value: number | string | null;
  reason: string;
  resolved?: boolean;
}

export interface PropertyValueOverride {
  value: number | string | null;
  source: string;
  updatedAt: string;
}

export interface ProviderHistory {
  date: string;
  price: number | null;
  status: string | null;
}

export interface Listing extends Required<ListingInput> {
  id: string;
  propertyId: string;
  firstFetchedAt: string;
  lastFetchedAt: string;
}

export interface Snapshot {
  id: number;
  listingId: string;
  fetchedAt: string;
  price: number | null;
  status: string;
}

export interface Note {
  id: number;
  propertyId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSearchInput {
  name: string;
  mode: ListingMode;
  location: string;
  filters?: Record<string, unknown>;
  priceMin?: number | null;
  priceMax?: number | null;
  /** Days between refreshes. Stays null until the refresh interval is decided. */
  refreshIntervalDays?: number | null;
}

export interface PersonalAssumptions {
  downPaymentPct: number;
  mortgageRatePct: number;
  termYears: number;
  maintenancePctPerYear: number;
  updatedAt?: string;
}

export interface LocalAssumptions {
  county: string;
  set: boolean;
  millage: number | null;
  typicalNonAdValoremPerYear: number | null;
  homeownersDefaultMonthly: number | null;
  ho6DefaultMonthly: number | null;
  floodDefaultMonthly: Record<string, number>;
  source: string | null;
  setOn: string | null;
  sample: boolean;
  pricePerSqftMin?: number | null;
  pricePerSqftMax?: number | null;
}

export interface ComparableRentRules {
  sameType: boolean;
  sameBeds: boolean;
  livingAreaTolerancePct: number;
  radiusMi: number;
  seenWithinDays: number;
  minComps: number;
  updatedAt?: string;
}

export interface ComparableRentFigure {
  propertyId: string;
  source: 'same_home' | 'local_comps' | 'rent_estimate' | 'unavailable';
  value: number | null;
  low: number | null;
  high: number | null;
  reason: string | null;
  compCount: number;
  maxDistanceMi: number | null;
  compIds: string[];
  estimateComps?: Array<{ address: string; rent: number; distanceMi: number | null }>;
  computedAt: string;
}

export interface RankingWeightSet {
  mode: ListingMode;
  weights: RankingWeights;
  /** Null while the mode still uses the default weights. */
  updatedAt: string | null;
}

export const defaultComparableRentRules: ComparableRentRules = {
  sameType: true,
  sameBeds: true,
  livingAreaTolerancePct: 20,
  radiusMi: 1,
  seenWithinDays: 30,
  minComps: 3,
};

export type CostEntryKind =
  | 'homeowners_quote'
  | 'ho6_quote'
  | 'flood_quote'
  | 'tax_bill'
  | 'tax_bill_cdd'
  | 'association_fee'
  | 'special_assessment'
  | 'assessments_none'
  | 'hoa_none'
  | 'flood_not_carried';
export type CostEntryState = 'Quote' | 'Doc' | 'N/A';
export interface PropertyCostEntry {
  id: number;
  propertyId: string;
  kind: CostEntryKind;
  amount: number | null;
  state: CostEntryState;
  source: string;
  date: string;
  assessmentStatus: 'pending' | 'approved' | null;
  paymentType: 'one_time' | 'installments' | null;
  amountUnknown: boolean;
  sample: boolean;
}
export type PropertyCostEntryInput = Omit<PropertyCostEntry, 'id' | 'propertyId'>;

export type SavedSearchUpdate = Partial<SavedSearchInput>;

export interface ListingSearchCriteria {
  mode: ListingMode;
  location?: string;
  zip?: string;
  priceMin?: number;
  priceMax?: number;
  beds?: number;
  baths?: number;
  propertyType?: string;
  minSqft?: number;
  statuses?: string[];
  sort?: 'newest' | 'price';
  showDismissed?: boolean;
  savedOnly?: boolean;
  /** Property-owned tags; all requested tags must be present. */
  tags?: string[];
}

export interface SavedSearch extends Required<SavedSearchInput> {
  id: number;
  pairedSearchId: number | null;
  lastSuccessfulRefreshAt: string | null;
  lastRefreshAttemptAt: string | null;
  lastRefreshError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRequestLog {
  id: number;
  provider: string;
  savedSearchId: number | null;
  propertyId: string | null;
  requestedAt: string;
  purpose: string;
  page: number;
  status: 'started' | 'succeeded' | 'failed';
  resultCount: number | null;
  errorMessage: string | null;
}

export interface OutsideProviderRequest {
  id: number;
  requestDate: string;
  count: number;
  note: string;
  createdAt: string;
}

export type ReviewDecision = 'link' | 'keep_separate';

export interface ReviewItem {
  id: number;
  incomingListing: unknown;
  candidatePropertyId: string;
  reason: string;
  decision: ReviewDecision | null;
  decidedAt: string | null;
  createdAt: string;
  createdListingId: string | null;
  createdPropertyId: string | null;
}

export interface ReviewListingInput {
  provider: string;
  sourceId: string;
  property: PropertyInput;
  listing: Omit<ListingInput, 'provider' | 'providerId'>;
  rawPayload: unknown;
}

/** What a decision restored from a backup keeps of the incoming listing. */
export interface RestoredReviewListing {
  provider: string;
  sourceId: string;
  restored: true;
  property: PropertyInput | null;
}

export interface StoreOptions {
  /** Called after every write, so the caller can save the database file. */
  afterWrite?: () => void;
  clock?: () => Date;
}

type Row = Record<string, SqlValue>;

const propertyColumns = `id, street, unit, city, zip, county, latitude, longitude, property_type, flood_zone,
  beds, baths_total, baths_full, baths_half, living_area_sqft, lot_size_sqft, year_built,
  parcel_id, sample, created_at, updated_at, risk_details, value_overrides`;

const listingColumns = `id, property_id, provider, provider_id, mls_name, mls_number, mode, price,
  price_period, status, hoa_fee, image_urls, source_url, agent_name, agent_phone, agent_email,
  office_name, office_phone, office_email, provider_listed_date, provider_removed_date,
  provider_last_seen_date, first_fetched_at, last_fetched_at, field_quality, provider_history, sample,
  implausible_flags`;

const searchColumns = `id, name, mode, location, filters, price_min, price_max, paired_search_id,
  refresh_interval_days, last_successful_refresh_at, last_refresh_attempt_at, last_refresh_error,
  created_at, updated_at`;

export function createStore(database: Database, options: StoreOptions = {}) {
  const now = () => (options.clock ?? (() => new Date()))().toISOString();
  let depth = 0;

  function all(sql: string, params: SqlValue[] = []): Row[] {
    const statement = database.prepare(sql);
    try {
      statement.bind(params);
      const result: Row[] = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally {
      statement.free();
    }
  }

  function one(sql: string, params: SqlValue[] = []): Row | undefined {
    return all(sql, params)[0];
  }

  function run(sql: string, params: SqlValue[] = []) {
    database.run(sql, params);
  }

  function lastInsertId(): number {
    return Number(one('SELECT last_insert_rowid() AS id')?.id);
  }

  // Runs fn as one unit of work: all of it is saved, or none of it. Nested calls
  // join the outer unit, and the database file is saved once, after the outermost.
  function transaction<T>(fn: () => T): T {
    if (depth > 0) return fn();
    depth += 1;
    database.run('BEGIN');
    try {
      const result = fn();
      database.run('COMMIT');
      depth -= 1;
      options.afterWrite?.();
      return result;
    } catch (error) {
      depth -= 1;
      database.run('ROLLBACK');
      throw error;
    }
  }

  function requireProperty(propertyId: string) {
    if (
      !propertyId.startsWith('prop_') ||
      !one('SELECT 1 FROM properties WHERE id = ?', [propertyId])
    ) {
      throw new Error(
        `Unknown property ID: ${propertyId}. Personal data is saved against a property, not a listing.`,
      );
    }
  }

  function requireListing(listingId: string) {
    if (!one('SELECT 1 FROM listings WHERE id = ?', [listingId])) {
      throw new Error(`Unknown listing ID: ${listingId}`);
    }
  }

  const text = (value: SqlValue) => (value === null ? null : String(value));
  const number = (value: SqlValue) => (value === null ? null : Number(value));

  function toProperty(row: Row): Property {
    return {
      id: String(row.id),
      street: String(row.street),
      unit: text(row.unit),
      city: String(row.city),
      zip: String(row.zip),
      county: text(row.county),
      latitude: number(row.latitude),
      longitude: number(row.longitude),
      propertyType: text(row.property_type),
      floodZone: text(row.flood_zone),
      riskDetails: { ...emptyRiskDetails, ...JSON.parse(String(row.risk_details ?? '{}')) },
      valueOverrides: JSON.parse(String(row.value_overrides ?? '{}')) as Record<
        string,
        PropertyValueOverride
      >,
      beds: number(row.beds),
      bathsTotal: number(row.baths_total),
      bathsFull: number(row.baths_full),
      bathsHalf: number(row.baths_half),
      livingAreaSqft: number(row.living_area_sqft),
      lotSizeSqft: number(row.lot_size_sqft),
      yearBuilt: number(row.year_built),
      parcelId: text(row.parcel_id),
      sample: row.sample === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  function toListing(row: Row): Listing {
    return {
      id: String(row.id),
      propertyId: String(row.property_id),
      provider: String(row.provider),
      providerId: String(row.provider_id),
      mlsName: text(row.mls_name),
      mlsNumber: text(row.mls_number),
      mode: row.mode as ListingMode,
      price: number(row.price),
      pricePeriod: row.price_period as PricePeriod,
      status: String(row.status),
      hoaFee: number(row.hoa_fee),
      imageUrls: JSON.parse(String(row.image_urls)) as string[],
      sourceUrl: text(row.source_url),
      agentName: text(row.agent_name),
      agentPhone: text(row.agent_phone),
      agentEmail: text(row.agent_email),
      officeName: text(row.office_name),
      officePhone: text(row.office_phone),
      officeEmail: text(row.office_email),
      providerListedDate: text(row.provider_listed_date),
      providerRemovedDate: text(row.provider_removed_date),
      providerLastSeenDate: text(row.provider_last_seen_date),
      firstFetchedAt: String(row.first_fetched_at),
      lastFetchedAt: String(row.last_fetched_at),
      fieldQuality: JSON.parse(String(row.field_quality)) as Record<string, string>,
      providerHistory: JSON.parse(String(row.provider_history)) as ProviderHistory[],
      sample: row.sample === 1,
      implausibleFlags: JSON.parse(String(row.implausible_flags ?? '[]')) as ImplausibleFlag[],
    };
  }

  function toSearch(row: Row): SavedSearch {
    return {
      id: Number(row.id),
      name: String(row.name),
      mode: row.mode as ListingMode,
      location: String(row.location),
      filters: JSON.parse(String(row.filters)) as Record<string, unknown>,
      priceMin: number(row.price_min),
      priceMax: number(row.price_max),
      pairedSearchId: number(row.paired_search_id),
      refreshIntervalDays: number(row.refresh_interval_days),
      lastSuccessfulRefreshAt: text(row.last_successful_refresh_at),
      lastRefreshAttemptAt: text(row.last_refresh_attempt_at),
      lastRefreshError: text(row.last_refresh_error),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  function toReview(row: Row): ReviewItem {
    return {
      id: Number(row.id),
      incomingListing: JSON.parse(String(row.incoming_listing)),
      candidatePropertyId: String(row.candidate_property_id),
      reason: String(row.reason),
      decision: row.decision === null ? null : (row.decision as ReviewDecision),
      decidedAt: text(row.decided_at),
      createdAt: String(row.created_at),
      createdListingId: text(row.created_listing_id),
      createdPropertyId: text(row.created_property_id),
    };
  }

  function insertListing(propertyId: string, input: ListingInput, at: string): Listing {
    const id = `lst_${randomUUID()}`;
    run(`INSERT INTO listings (${listingColumns}) VALUES (${Array(28).fill('?').join(', ')})`, [
      id,
      propertyId,
      input.provider,
      input.providerId,
      input.mlsName ?? null,
      input.mlsNumber ?? null,
      input.mode,
      input.price ?? null,
      input.pricePeriod,
      input.status,
      input.hoaFee ?? null,
      JSON.stringify(input.imageUrls ?? []),
      input.sourceUrl ?? null,
      input.agentName ?? null,
      input.agentPhone ?? null,
      input.agentEmail ?? null,
      input.officeName ?? null,
      input.officePhone ?? null,
      input.officeEmail ?? null,
      input.providerListedDate ?? null,
      input.providerRemovedDate ?? null,
      input.providerLastSeenDate ?? null,
      at,
      at,
      JSON.stringify(input.fieldQuality ?? {}),
      JSON.stringify(input.providerHistory ?? []),
      input.sample ? 1 : 0,
      JSON.stringify(input.implausibleFlags ?? []),
    ]);
    return getListing(id)!;
  }

  function getListing(listingId: string): Listing | null {
    const row = one(`SELECT ${listingColumns} FROM listings WHERE id = ?`, [listingId]);
    return row ? toListing(row) : null;
  }

  const store = {
    /** Group related store writes into one durable unit of work. */
    transaction<T>(fn: () => T): T {
      return transaction(fn);
    },

    // Properties

    createProperty(input: PropertyInput): Property {
      return transaction(() => {
        const id = `prop_${randomUUID()}`;
        const at = now();
        run(
          `INSERT INTO properties (${propertyColumns}) VALUES (${Array(23).fill('?').join(', ')})`,
          [
            id,
            input.street,
            input.unit ?? null,
            input.city,
            input.zip,
            input.county ?? null,
            input.latitude ?? null,
            input.longitude ?? null,
            input.propertyType ?? null,
            input.floodZone ?? null,
            input.beds ?? null,
            input.bathsTotal ?? null,
            input.bathsFull ?? null,
            input.bathsHalf ?? null,
            input.livingAreaSqft ?? null,
            input.lotSizeSqft ?? null,
            input.yearBuilt ?? null,
            input.parcelId ?? null,
            input.sample ? 1 : 0,
            at,
            at,
            JSON.stringify({ ...emptyRiskDetails, ...(input.riskDetails ?? {}) }),
            '{}',
          ],
        );
        return store.getProperty(id)!;
      });
    },

    getProperty(propertyId: string): Property | null {
      const row = one(`SELECT ${propertyColumns} FROM properties WHERE id = ?`, [propertyId]);
      return row ? toProperty(row) : null;
    },

    setImplausibleFlags(listingId: string, flags: ImplausibleFlag[]) {
      return transaction(() => {
        requireListing(listingId);
        run('UPDATE listings SET implausible_flags = ? WHERE id = ?', [
          JSON.stringify(flags),
          listingId,
        ]);
        return store.getListing(listingId)!;
      });
    },

    setPropertyValueOverrides(
      propertyId: string,
      overrides: Record<string, PropertyValueOverride>,
    ) {
      return transaction(() => {
        requireProperty(propertyId);
        run('UPDATE properties SET value_overrides = ? WHERE id = ?', [
          JSON.stringify(overrides),
          propertyId,
        ]);
        return store.getProperty(propertyId)!;
      });
    },

    resolveImplausibleFlag(
      listingId: string,
      field: string,
      input: { correct?: number; source?: string },
    ) {
      return transaction(() => {
        const listing = store.getListing(listingId);
        if (!listing) throw new Error('Listing not found.');
        const flags = listing.implausibleFlags.map((flag) =>
          flag.field === field ? { ...flag, resolved: true } : flag,
        );
        if (!listing.implausibleFlags.some((flag) => flag.field === field && !flag.resolved))
          throw new Error('Flag not found.');
        const property = store.getProperty(listing.propertyId)!;
        if (input.correct !== undefined) {
          const source = input.source?.trim();
          if (!source || source.length > 200)
            throw new Error('Enter a source for the corrected value.');
          const propertyFields: Record<string, string> = {
            livingAreaSqft: 'living_area_sqft',
            beds: 'beds',
            latitude: 'latitude',
            longitude: 'longitude',
          };
          const column = propertyFields[field];
          if (column) {
            run(`UPDATE properties SET ${column} = ?, updated_at = ? WHERE id = ?`, [
              input.correct,
              now(),
              property.id,
            ]);
            const overrides = {
              ...(property.valueOverrides ?? {}),
              [field]: { value: input.correct, source, updatedAt: now() },
            };
            run('UPDATE properties SET value_overrides = ? WHERE id = ?', [
              JSON.stringify(overrides),
              property.id,
            ]);
          } else if (field === 'price') {
            run('UPDATE listings SET price = ? WHERE id = ?', [input.correct, listingId]);
            const overrides = {
              ...(property.valueOverrides ?? {}),
              [`${listingId}:price`]: { value: input.correct, source, updatedAt: now() },
            };
            run('UPDATE properties SET value_overrides = ? WHERE id = ?', [
              JSON.stringify(overrides),
              property.id,
            ]);
          } else {
            throw new Error('This field cannot be corrected here.');
          }
        }
        return store.setImplausibleFlags(listingId, flags);
      });
    },

    updateRiskDetails(
      propertyId: string,
      floodZone: string | null,
      riskDetails: PropertyRiskDetails,
    ) {
      return transaction(() => {
        requireProperty(propertyId);
        run('UPDATE properties SET flood_zone = ?, risk_details = ?, updated_at = ? WHERE id = ?', [
          floodZone,
          JSON.stringify(riskDetails),
          now(),
          propertyId,
        ]);
        return store.getProperty(propertyId)!;
      });
    },

    /** Exact match on normalized street, unit, city, and ZIP. */
    findPropertyByAddress(address: Pick<PropertyInput, 'street' | 'unit' | 'city' | 'zip'>) {
      const row = one(
        `SELECT ${propertyColumns} FROM properties
         WHERE street = ? AND COALESCE(unit, '') = ? AND city = ? AND zip = ?`,
        [address.street, address.unit ?? '', address.city, address.zip],
      );
      return row ? toProperty(row) : null;
    },

    /** Properties with the same street address in the same city and ZIP, any unit. */
    findPropertiesOnStreetAddress(address: Pick<PropertyInput, 'street' | 'city' | 'zip'>) {
      return all(
        `SELECT ${propertyColumns} FROM properties WHERE street = ? AND city = ? AND zip = ? ORDER BY unit`,
        [address.street, address.city, address.zip],
      ).map(toProperty);
    },

    listProperties(): Property[] {
      return all(`SELECT ${propertyColumns} FROM properties ORDER BY created_at, id`).map(
        toProperty,
      );
    },

    listCustomTags() {
      return all(
        'SELECT id, name, created_at FROM custom_tags ORDER BY name COLLATE NOCASE, id',
      ).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        createdAt: String(row.created_at),
      }));
    },

    createCustomTag(name: string) {
      const cleanName = name.trim();
      if (!cleanName) throw new Error('Enter a tag name.');
      if (cleanName.length > 30) throw new Error('Tags must be 30 characters or fewer.');
      const normalizedName = normalizedTagName(cleanName);
      if (
        standardPersonalTags.some((tag) => normalizedTagName(tag) === normalizedName) ||
        one('SELECT 1 FROM custom_tags WHERE normalized_name = ?', [normalizedName])
      ) {
        throw new Error('That tag already exists.');
      }
      const id = `tag_${randomUUID()}`;
      const createdAt = now();
      transaction(() =>
        run('INSERT INTO custom_tags (id, name, normalized_name, created_at) VALUES (?, ?, ?, ?)', [
          id,
          cleanName,
          normalizedName,
          createdAt,
        ]),
      );
      return { id, name: cleanName, createdAt };
    },

    listCustomTagsWithCounts() {
      return all(
        `SELECT t.id, t.name, t.created_at, COUNT(DISTINCT p.property_id) AS property_count
         FROM custom_tags t LEFT JOIN property_tags p ON p.normalized_name = t.normalized_name
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE, t.id`,
      ).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        createdAt: String(row.created_at),
        propertyCount: Number(row.property_count),
      }));
    },

    listStandardTagsWithCounts() {
      return standardPersonalTags.map((name) => ({
        name,
        propertyCount: Number(
          one(
            'SELECT COUNT(DISTINCT property_id) AS count FROM property_tags WHERE normalized_name = ?',
            [normalizedTagName(name)],
          )?.count ?? 0,
        ),
      }));
    },

    renameCustomTag(tagId: string, name: string) {
      const current = one('SELECT id, name, normalized_name FROM custom_tags WHERE id = ?', [
        tagId,
      ]);
      if (!current) throw new Error('Custom tag not found.');
      const cleanName = name.trim();
      if (!cleanName) throw new Error('Enter a tag name.');
      if (cleanName.length > 30) throw new Error('Tags must be 30 characters or fewer.');
      const normalizedName = normalizedTagName(cleanName);
      if (
        standardPersonalTags.some((tag) => normalizedTagName(tag) === normalizedName) ||
        one('SELECT 1 FROM custom_tags WHERE normalized_name = ? AND id <> ?', [
          normalizedName,
          tagId,
        ])
      ) {
        throw new Error('That tag already exists.');
      }
      transaction(() => {
        run('UPDATE custom_tags SET name = ?, normalized_name = ? WHERE id = ?', [
          cleanName,
          normalizedName,
          tagId,
        ]);
        run(
          'UPDATE property_tags SET tag_name = ?, normalized_name = ? WHERE normalized_name = ?',
          [cleanName, normalizedName, String(current.normalized_name)],
        );
      });
      return store.listCustomTagsWithCounts().find((tag) => tag.id === tagId)!;
    },

    deleteCustomTag(tagId: string) {
      const current = one('SELECT normalized_name FROM custom_tags WHERE id = ?', [tagId]);
      if (!current) throw new Error('Custom tag not found.');
      const propertyCount = Number(
        one(
          'SELECT COUNT(DISTINCT property_id) AS count FROM property_tags WHERE normalized_name = ?',
          [String(current.normalized_name)],
        )?.count ?? 0,
      );
      transaction(() => {
        run('DELETE FROM property_tags WHERE normalized_name = ?', [
          String(current.normalized_name),
        ]);
        run('DELETE FROM custom_tags WHERE id = ?', [tagId]);
      });
      return { id: tagId, propertyCount };
    },

    listPropertyTags(propertyId: string): PersonalTag[] {
      return all(
        'SELECT tag_name, date_added FROM property_tags WHERE property_id = ? ORDER BY tag_name COLLATE NOCASE',
        [propertyId],
      ).map((row) => ({ name: String(row.tag_name), dateAdded: String(row.date_added) }));
    },

    setPropertyTag(propertyId: string, name: string, enabled: boolean) {
      requireProperty(propertyId);
      const cleanName = name.trim();
      const normalizedName = normalizedTagName(cleanName);
      const customTag = one('SELECT name FROM custom_tags WHERE normalized_name = ?', [
        normalizedName,
      ]);
      const standardTag = standardPersonalTags.find(
        (tag) => normalizedTagName(tag) === normalizedName,
      );
      if (!standardTag && !customTag) throw new Error('Choose a standard or custom tag.');
      const tagName = standardTag ?? String(customTag?.name);
      transaction(() => {
        if (enabled) {
          run(
            `INSERT OR IGNORE INTO property_tags (property_id, tag_name, normalized_name, date_added)
             VALUES (?, ?, ?, ?)`,
            [propertyId, tagName, normalizedName, now()],
          );
        } else {
          run('DELETE FROM property_tags WHERE property_id = ? AND normalized_name = ?', [
            propertyId,
            normalizedName,
          ]);
        }
      });
      return store.listPropertyTags(propertyId);
    },

    // Listings

    getListing,

    listListings(propertyId: string): Listing[] {
      return all(`SELECT ${listingColumns} FROM listings WHERE property_id = ? ORDER BY mode, id`, [
        propertyId,
      ]).map(toListing);
    },

    listAllListings(): Listing[] {
      return all(`SELECT ${listingColumns} FROM listings ORDER BY id`).map(toListing);
    },

    getComparableRentRules(): ComparableRentRules {
      const row = one('SELECT * FROM comparable_rent_rules WHERE id = 1');
      return row
        ? {
            sameType: row.same_type === 1,
            sameBeds: row.same_beds === 1,
            livingAreaTolerancePct: Number(row.living_area_tolerance_pct),
            radiusMi: Number(row.radius_mi),
            seenWithinDays: Number(row.seen_within_days),
            minComps: Number(row.min_comps),
            updatedAt: String(row.updated_at),
          }
        : { ...defaultComparableRentRules };
    },

    setComparableRentRules(input: ComparableRentRules): ComparableRentRules {
      const updatedAt = input.updatedAt ?? now();
      transaction(() => {
        run(
          `INSERT INTO comparable_rent_rules
            (id, same_type, same_beds, living_area_tolerance_pct, radius_mi, seen_within_days, min_comps, updated_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET same_type=excluded.same_type, same_beds=excluded.same_beds,
             living_area_tolerance_pct=excluded.living_area_tolerance_pct, radius_mi=excluded.radius_mi,
             seen_within_days=excluded.seen_within_days, min_comps=excluded.min_comps, updated_at=excluded.updated_at`,
          [
            input.sameType ? 1 : 0,
            input.sameBeds ? 1 : 0,
            input.livingAreaTolerancePct,
            input.radiusMi,
            input.seenWithinDays,
            input.minComps,
            updatedAt,
          ],
        );
      });
      return store.getComparableRentRules();
    },

    getRankingWeights(mode: ListingMode): RankingWeightSet {
      const row = one('SELECT * FROM ranking_weights WHERE mode = ?', [mode]);
      return row
        ? {
            mode,
            weights: {
              ...defaultRankingWeights[mode],
              ...(JSON.parse(String(row.weights)) as RankingWeights),
            },
            updatedAt: String(row.updated_at),
          }
        : { mode, weights: { ...defaultRankingWeights[mode] }, updatedAt: null };
    },

    setRankingWeights(
      mode: ListingMode,
      weights: RankingWeights,
      updatedAt = now(),
    ): RankingWeightSet {
      transaction(() => {
        run(
          `INSERT INTO ranking_weights (mode, weights, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(mode) DO UPDATE SET weights=excluded.weights, updated_at=excluded.updated_at`,
          [mode, JSON.stringify(weights), updatedAt],
        );
      });
      return store.getRankingWeights(mode);
    },

    saveComparableRentFigure(input: ComparableRentFigure): ComparableRentFigure {
      transaction(() => {
        requireProperty(input.propertyId);
        run(
          `INSERT INTO comparable_rent_figures
            (property_id, source, value, low, high, reason, comp_count, max_distance_mi, comp_ids, estimate_comps, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(property_id) DO UPDATE SET source=excluded.source, value=excluded.value,
             low=excluded.low, high=excluded.high, reason=excluded.reason, comp_count=excluded.comp_count,
             max_distance_mi=excluded.max_distance_mi, comp_ids=excluded.comp_ids,
             estimate_comps=excluded.estimate_comps, computed_at=excluded.computed_at`,
          [
            input.propertyId,
            input.source,
            input.value,
            input.low,
            input.high,
            input.reason,
            input.compCount,
            input.maxDistanceMi,
            JSON.stringify(input.compIds),
            JSON.stringify(input.estimateComps ?? []),
            input.computedAt,
          ],
        );
      });
      return input;
    },

    getComparableRentFigure(propertyId: string): ComparableRentFigure | null {
      const row = one('SELECT * FROM comparable_rent_figures WHERE property_id = ?', [propertyId]);
      return row
        ? {
            propertyId: String(row.property_id),
            source: String(row.source) as ComparableRentFigure['source'],
            value: number(row.value),
            low: number(row.low),
            high: number(row.high),
            reason: text(row.reason),
            compCount: Number(row.comp_count),
            maxDistanceMi: number(row.max_distance_mi),
            compIds: JSON.parse(String(row.comp_ids)) as string[],
            estimateComps: JSON.parse(
              String(row.estimate_comps),
            ) as ComparableRentFigure['estimateComps'],
            computedAt: String(row.computed_at),
          }
        : null;
    },

    searchListings(criteria: ListingSearchCriteria) {
      const clauses = ['l.mode = ?'];
      const params: SqlValue[] = [criteria.mode];
      const add = (condition: string, value: SqlValue) => {
        clauses.push(condition);
        params.push(value);
      };
      if (!criteria.showDismissed) clauses.push('d.property_id IS NULL');
      if (criteria.savedOnly) clauses.push('f.property_id IS NOT NULL');
      if (criteria.location?.trim()) {
        add(
          "LOWER(p.city || ' ' || p.zip || ' ' || p.street) LIKE ?",
          `%${criteria.location.trim().toLocaleLowerCase('en-US')}%`,
        );
      }
      if (criteria.zip) add('p.zip = ?', criteria.zip);
      if (criteria.priceMin !== undefined) add('l.price >= ?', criteria.priceMin);
      if (criteria.priceMax !== undefined) add('l.price <= ?', criteria.priceMax);
      if (criteria.beds !== undefined) add('p.beds >= ?', criteria.beds);
      if (criteria.baths !== undefined) add('p.baths_total >= ?', criteria.baths);
      if (criteria.propertyType) add('p.property_type = ?', criteria.propertyType);
      if (criteria.minSqft !== undefined) add('p.living_area_sqft >= ?', criteria.minSqft);
      const statuses = criteria.statuses?.length ? criteria.statuses : ['active'];
      clauses.push(`LOWER(l.status) IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses.map((status) => status.toLocaleLowerCase('en-US')));
      const order =
        criteria.sort === 'price'
          ? 'l.price ASC, p.city COLLATE NOCASE, p.street COLLATE NOCASE'
          : 'COALESCE(l.provider_last_seen_date, l.last_fetched_at) DESC, l.last_fetched_at DESC, l.id';
      const propertySelect = propertyColumns
        .split(',')
        .map((column) => `p.${column.trim()} AS p_${column.trim()}`)
        .join(', ');
      const listingSelect = listingColumns
        .split(',')
        .map((column) => `l.${column.trim()} AS l_${column.trim()}`)
        .join(', ');
      return all(
        `SELECT ${propertySelect}, ${listingSelect},
           (f.property_id IS NOT NULL) AS is_saved, (d.property_id IS NOT NULL) AS is_dismissed
         FROM listings l JOIN properties p ON p.id = l.property_id
         LEFT JOIN property_dismissals d ON d.property_id = p.id
         LEFT JOIN property_favorites f ON f.property_id = p.id
         WHERE ${clauses.join(' AND ')} ORDER BY ${order}`,
        params,
      ).map((row) => {
        const property = toProperty(
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.replace(/^p_/, ''), value]),
          ),
        );
        const listing = toListing(
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.replace(/^l_/, ''), value]),
          ),
        );
        return { property, listing, saved: row.is_saved === 1, dismissed: row.is_dismissed === 1 };
      });
    },

    getListingByProviderId(provider: string, providerId: string): Listing | null {
      const row = one(
        `SELECT ${listingColumns} FROM listings WHERE provider = ? AND provider_id = ?`,
        [provider, providerId],
      );
      return row ? toListing(row) : null;
    },

    deleteListing(listingId: string) {
      transaction(() => run('DELETE FROM listings WHERE id = ?', [listingId]));
    },

    deleteProperty(propertyId: string) {
      transaction(() => run('DELETE FROM properties WHERE id = ?', [propertyId]));
    },

    /**
     * Replaces every listing of a property. The property and its notes, favorite,
     * and dismissal are untouched; the old listings go with their snapshots and
     * raw payloads.
     */
    replaceListings(propertyId: string, inputs: ListingInput[]): Listing[] {
      return transaction(() => {
        requireProperty(propertyId);
        run('DELETE FROM listings WHERE property_id = ?', [propertyId]);
        const at = now();
        const created = inputs.map((input) => insertListing(propertyId, input, at));
        run('UPDATE properties SET updated_at = ? WHERE id = ?', [at, propertyId]);
        return created;
      });
    },

    /**
     * Adds a listing, or refreshes the one already stored for the same provider and
     * provider ID: first-fetched time is kept, last-fetched time moves.
     */
    upsertListing(propertyId: string, input: ListingInput): Listing {
      return transaction(() => {
        requireProperty(propertyId);
        const at = now();
        const existing = one(
          'SELECT id, property_id FROM listings WHERE provider = ? AND provider_id = ?',
          [input.provider, input.providerId],
        );
        if (!existing) return insertListing(propertyId, input, at);
        if (existing.property_id !== propertyId) {
          throw new Error(
            `Listing ${input.provider}/${input.providerId} belongs to another property`,
          );
        }
        run(
          `UPDATE listings SET mls_name = ?, mls_number = ?, mode = ?, price = ?, price_period = ?,
             status = ?, hoa_fee = ?, image_urls = ?, source_url = ?, agent_name = ?, agent_phone = ?,
             agent_email = ?, office_name = ?, office_phone = ?, office_email = ?,
             provider_listed_date = ?, provider_removed_date = ?, provider_last_seen_date = ?,
             last_fetched_at = ?, field_quality = ?, provider_history = ?, sample = ?, implausible_flags = ?
           WHERE id = ?`,
          [
            input.mlsName ?? null,
            input.mlsNumber ?? null,
            input.mode,
            input.price ?? null,
            input.pricePeriod,
            input.status,
            input.hoaFee ?? null,
            JSON.stringify(input.imageUrls ?? []),
            input.sourceUrl ?? null,
            input.agentName ?? null,
            input.agentPhone ?? null,
            input.agentEmail ?? null,
            input.officeName ?? null,
            input.officePhone ?? null,
            input.officeEmail ?? null,
            input.providerListedDate ?? null,
            input.providerRemovedDate ?? null,
            input.providerLastSeenDate ?? null,
            at,
            JSON.stringify(input.fieldQuality ?? {}),
            JSON.stringify(input.providerHistory ?? []),
            input.sample ? 1 : 0,
            JSON.stringify(input.implausibleFlags ?? []),
            String(existing.id),
          ],
        );
        return getListing(String(existing.id))!;
      });
    },

    // Snapshots

    addSnapshot(
      listingId: string,
      snapshot: { fetchedAt?: string; price: number | null; status: string },
    ) {
      return transaction(() => {
        requireListing(listingId);
        run(
          'INSERT INTO listing_snapshots (listing_id, fetched_at, price, status) VALUES (?, ?, ?, ?)',
          [listingId, snapshot.fetchedAt ?? now(), snapshot.price, snapshot.status],
        );
        return lastInsertId();
      });
    },

    listSnapshots(listingId: string): Snapshot[] {
      return all(
        'SELECT id, listing_id, fetched_at, price, status FROM listing_snapshots WHERE listing_id = ? ORDER BY fetched_at, id',
        [listingId],
      ).map((row) => ({
        id: Number(row.id),
        listingId: String(row.listing_id),
        fetchedAt: String(row.fetched_at),
        price: number(row.price),
        status: String(row.status),
      }));
    },

    // Raw payloads. Server-side debugging only: no API route returns these.

    addRawPayload(listingId: string, payload: unknown, fetchedAt?: string) {
      return transaction(() => {
        requireListing(listingId);
        run('INSERT INTO listing_raw_payloads (listing_id, fetched_at, payload) VALUES (?, ?, ?)', [
          listingId,
          fetchedAt ?? now(),
          JSON.stringify(payload),
        ]);
        return lastInsertId();
      });
    },

    listRawPayloads(listingId: string) {
      return all(
        'SELECT id, fetched_at, payload FROM listing_raw_payloads WHERE listing_id = ? ORDER BY fetched_at, id',
        [listingId],
      ).map((row) => ({
        id: Number(row.id),
        fetchedAt: String(row.fetched_at),
        payload: JSON.parse(String(row.payload)) as unknown,
      }));
    },

    // Personal data, keyed to a property

    /** Timestamps are only passed when restoring a backup; otherwise the note is stamped now. */
    addNote(
      propertyId: string,
      body: string,
      timestamps: { createdAt?: string; updatedAt?: string } = {},
    ): Note {
      return transaction(() => {
        requireProperty(propertyId);
        const createdAt = timestamps.createdAt ?? now();
        const updatedAt = timestamps.updatedAt ?? createdAt;
        run(
          'INSERT INTO property_notes (property_id, body, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [propertyId, body, createdAt, updatedAt],
        );
        return { id: lastInsertId(), propertyId, body, createdAt, updatedAt };
      });
    },

    updateNote(noteId: number, body: string) {
      transaction(() => {
        if (!one('SELECT 1 FROM property_notes WHERE id = ?', [noteId])) {
          throw new Error('Note not found.');
        }
        run('UPDATE property_notes SET body = ?, updated_at = ? WHERE id = ?', [
          body,
          now(),
          noteId,
        ]);
      });
    },

    deleteNote(noteId: number) {
      transaction(() => {
        if (!one('SELECT 1 FROM property_notes WHERE id = ?', [noteId])) {
          throw new Error('Note not found.');
        }
        run('DELETE FROM property_notes WHERE id = ?', [noteId]);
      });
    },

    listNotes(propertyId: string): Note[] {
      return all(
        'SELECT id, property_id, body, created_at, updated_at FROM property_notes WHERE property_id = ? ORDER BY created_at, id',
        [propertyId],
      ).map((row) => ({
        id: Number(row.id),
        propertyId: String(row.property_id),
        body: String(row.body),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    },

    addPropertyPhoto(
      propertyId: string,
      input: Omit<PropertyPhoto, 'id' | 'propertyId' | 'order'> & { order?: number },
    ) {
      return transaction(() => {
        requireProperty(propertyId);
        const order =
          input.order ??
          Number(
            one(
              'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM property_photos WHERE property_id = ?',
              [propertyId],
            )?.next ?? 0,
          );
        const id = `photo_${randomUUID()}`;
        run(
          'INSERT INTO property_photos (id, property_id, path, source, date_added, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [id, propertyId, input.path, input.source, input.dateAdded, order],
        );
        return {
          id,
          propertyId,
          path: input.path,
          source: input.source,
          dateAdded: input.dateAdded,
          order,
        } satisfies PropertyPhoto;
      });
    },

    listPropertyPhotos(propertyId: string): PropertyPhoto[] {
      return all(
        'SELECT id, property_id, path, source, date_added, sort_order FROM property_photos WHERE property_id = ? ORDER BY sort_order, id',
        [propertyId],
      ).map((row) => ({
        id: String(row.id),
        propertyId: String(row.property_id),
        path: String(row.path),
        source: String(row.source),
        dateAdded: String(row.date_added),
        order: Number(row.sort_order),
      }));
    },

    getPropertyPhoto(photoId: string): PropertyPhoto | null {
      const row = one(
        'SELECT id, property_id, path, source, date_added, sort_order FROM property_photos WHERE id = ?',
        [photoId],
      );
      return row
        ? {
            id: String(row.id),
            propertyId: String(row.property_id),
            path: String(row.path),
            source: String(row.source),
            dateAdded: String(row.date_added),
            order: Number(row.sort_order),
          }
        : null;
    },

    deletePropertyPhoto(photoId: string) {
      const row = one('SELECT property_id FROM property_photos WHERE id = ?', [photoId]);
      if (!row) return null;
      transaction(() => run('DELETE FROM property_photos WHERE id = ?', [photoId]));
      return String(row.property_id);
    },

    addCostEntry(propertyId: string, input: PropertyCostEntryInput): PropertyCostEntry {
      return transaction(() => {
        requireProperty(propertyId);
        run(
          `INSERT INTO property_cost_entries (property_id, kind, amount, state, source, entry_date,
          assessment_status, payment_type, amount_unknown, sample, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            propertyId,
            input.kind,
            input.amount,
            input.state,
            input.source,
            input.date,
            input.assessmentStatus,
            input.paymentType,
            input.amountUnknown ? 1 : 0,
            input.sample ? 1 : 0,
            now(),
          ],
        );
        return store.listCostEntries(propertyId).at(-1)!;
      });
    },

    listCostEntries(propertyId: string): PropertyCostEntry[] {
      return all(`SELECT * FROM property_cost_entries WHERE property_id = ? ORDER BY id`, [
        propertyId,
      ]).map((row) => ({
        id: Number(row.id),
        propertyId: String(row.property_id),
        kind: String(row.kind) as CostEntryKind,
        amount: number(row.amount),
        state: String(row.state) as CostEntryState,
        source: String(row.source),
        date: String(row.entry_date),
        assessmentStatus: text(row.assessment_status) as PropertyCostEntry['assessmentStatus'],
        paymentType: text(row.payment_type) as PropertyCostEntry['paymentType'],
        amountUnknown: row.amount_unknown === 1,
        sample: row.sample === 1,
      }));
    },

    setFavorite(propertyId: string, favorite: boolean, at?: string) {
      transaction(() => {
        requireProperty(propertyId);
        if (favorite) {
          run('INSERT OR IGNORE INTO property_favorites (property_id, created_at) VALUES (?, ?)', [
            propertyId,
            at ?? now(),
          ]);
        } else {
          run('DELETE FROM property_favorites WHERE property_id = ?', [propertyId]);
        }
      });
    },

    isFavorite(propertyId: string): boolean {
      return !!one('SELECT 1 FROM property_favorites WHERE property_id = ?', [propertyId]);
    },

    setDismissed(propertyId: string, dismissed: boolean, at?: string) {
      transaction(() => {
        requireProperty(propertyId);
        if (dismissed) {
          run(
            'INSERT OR IGNORE INTO property_dismissals (property_id, dismissed_at) VALUES (?, ?)',
            [propertyId, at ?? now()],
          );
        } else {
          run('DELETE FROM property_dismissals WHERE property_id = ?', [propertyId]);
        }
      });
    },

    isDismissed(propertyId: string): boolean {
      return !!one('SELECT 1 FROM property_dismissals WHERE property_id = ?', [propertyId]);
    },

    listFavorites(): Array<{ propertyId: string; createdAt: string }> {
      return all('SELECT property_id, created_at FROM property_favorites ORDER BY property_id').map(
        (row) => ({ propertyId: String(row.property_id), createdAt: String(row.created_at) }),
      );
    },

    listDismissals(): Array<{ propertyId: string; dismissedAt: string }> {
      return all(
        'SELECT property_id, dismissed_at FROM property_dismissals ORDER BY property_id',
      ).map((row) => ({
        propertyId: String(row.property_id),
        dismissedAt: String(row.dismissed_at),
      }));
    },

    // Saved searches

    /** Timestamps are only passed when restoring a backup; otherwise the search is stamped now. */
    createSavedSearch(
      input: SavedSearchInput,
      timestamps: { createdAt?: string; updatedAt?: string } = {},
    ): SavedSearch {
      return transaction(() => {
        const at = now();
        run(
          `INSERT INTO saved_searches (name, mode, location, filters, price_min, price_max,
             refresh_interval_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.name,
            input.mode,
            input.location,
            JSON.stringify(input.filters ?? {}),
            input.priceMin ?? null,
            input.priceMax ?? null,
            input.refreshIntervalDays ?? null,
            timestamps.createdAt ?? at,
            timestamps.updatedAt ?? timestamps.createdAt ?? at,
          ],
        );
        const id = lastInsertId();
        store.setPersonalAssumptions(id, {
          downPaymentPct: 20,
          mortgageRatePct: 6.5,
          termYears: 30,
          maintenancePctPerYear: 1,
        });
        return store.getSavedSearch(id)!;
      });
    },

    getSavedSearch(searchId: number): SavedSearch | null {
      const row = one(`SELECT ${searchColumns} FROM saved_searches WHERE id = ?`, [searchId]);
      return row ? toSearch(row) : null;
    },

    listSavedSearches(): SavedSearch[] {
      return all(`SELECT ${searchColumns} FROM saved_searches ORDER BY id`).map(toSearch);
    },

    getPersonalAssumptions(searchId: number): PersonalAssumptions | null {
      const row = one('SELECT * FROM personal_assumptions WHERE saved_search_id = ?', [searchId]);
      return row
        ? {
            downPaymentPct: Number(row.down_payment_pct),
            mortgageRatePct: Number(row.mortgage_rate_pct),
            termYears: Number(row.term_years),
            maintenancePctPerYear: Number(row.maintenance_pct_per_year),
            updatedAt: String(row.updated_at),
          }
        : null;
    },

    setPersonalAssumptions(searchId: number, input: PersonalAssumptions) {
      transaction(() => {
        if (!store.getSavedSearch(searchId)) throw new Error('Saved search not found.');
        run(
          `INSERT INTO personal_assumptions
            (saved_search_id, down_payment_pct, mortgage_rate_pct, term_years,
             maintenance_pct_per_year, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (saved_search_id) DO UPDATE SET
             down_payment_pct = excluded.down_payment_pct,
             mortgage_rate_pct = excluded.mortgage_rate_pct,
             term_years = excluded.term_years,
             maintenance_pct_per_year = excluded.maintenance_pct_per_year,
             updated_at = excluded.updated_at`,
          [
            searchId,
            input.downPaymentPct,
            input.mortgageRatePct,
            input.termYears,
            input.maintenancePctPerYear,
            input.updatedAt ?? now(),
          ],
        );
      });
      return store.getPersonalAssumptions(searchId)!;
    },

    listLocalAssumptions(): LocalAssumptions[] {
      return all('SELECT * FROM local_assumptions ORDER BY county').map((row) => ({
        county: String(row.county),
        set: row.is_set === 1,
        millage: number(row.millage),
        typicalNonAdValoremPerYear: number(row.typical_non_ad_valorem_per_year),
        homeownersDefaultMonthly: number(row.homeowners_default_monthly),
        ho6DefaultMonthly: number(row.ho6_default_monthly),
        floodDefaultMonthly: JSON.parse(String(row.flood_default_monthly)) as Record<
          string,
          number
        >,
        source: text(row.source),
        setOn: text(row.set_on),
        sample: row.sample === 1,
        pricePerSqftMin: number(row.price_per_sqft_min),
        pricePerSqftMax: number(row.price_per_sqft_max),
      }));
    },

    setLocalAssumption(input: LocalAssumptions) {
      transaction(() =>
        run(
          `INSERT INTO local_assumptions
          (county, is_set, millage, typical_non_ad_valorem_per_year, homeowners_default_monthly,
           ho6_default_monthly, flood_default_monthly, source, set_on, sample, price_per_sqft_min, price_per_sqft_max)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (county) DO UPDATE SET is_set = excluded.is_set, millage = excluded.millage,
           typical_non_ad_valorem_per_year = excluded.typical_non_ad_valorem_per_year,
           homeowners_default_monthly = excluded.homeowners_default_monthly,
           ho6_default_monthly = excluded.ho6_default_monthly,
           flood_default_monthly = excluded.flood_default_monthly, source = excluded.source,
           set_on = excluded.set_on, sample = excluded.sample, price_per_sqft_min = excluded.price_per_sqft_min,
           price_per_sqft_max = excluded.price_per_sqft_max`,
          [
            input.county,
            input.set ? 1 : 0,
            input.millage,
            input.typicalNonAdValoremPerYear,
            input.homeownersDefaultMonthly,
            input.ho6DefaultMonthly,
            JSON.stringify(input.floodDefaultMonthly),
            input.source,
            input.setOn,
            input.sample ? 1 : 0,
            input.pricePerSqftMin ?? null,
            input.pricePerSqftMax ?? null,
          ],
        ),
      );
      return store.listLocalAssumptions().find((item) => item.county === input.county)!;
    },

    listDueSavedSearches(at = now()): SavedSearch[] {
      return store.listSavedSearches().filter((search) => {
        if (search.refreshIntervalDays == null) return false;
        if (search.lastSuccessfulRefreshAt == null) return true;
        return (
          Date.parse(at) - Date.parse(search.lastSuccessfulRefreshAt) >=
          search.refreshIntervalDays * 24 * 60 * 60 * 1000
        );
      });
    },

    markRefreshStarted(searchId: number) {
      transaction(() => {
        if (!store.getSavedSearch(searchId)) throw new Error('Saved search not found.');
        run(
          'UPDATE saved_searches SET last_refresh_attempt_at = ?, last_refresh_error = NULL WHERE id = ?',
          [now(), searchId],
        );
      });
    },

    markRefreshSucceeded(searchId: number, at = now()) {
      transaction(() =>
        run(
          'UPDATE saved_searches SET last_successful_refresh_at = ?, last_refresh_attempt_at = ?, last_refresh_error = NULL WHERE id = ?',
          [at, at, searchId],
        ),
      );
    },

    markRefreshFailed(searchId: number, error: string, at = now()) {
      transaction(() =>
        run(
          'UPDATE saved_searches SET last_refresh_attempt_at = ?, last_refresh_error = ? WHERE id = ?',
          [at, error, searchId],
        ),
      );
    },

    beginProviderRequest(input: {
      provider: string;
      savedSearchId?: number;
      propertyId?: string;
      purpose: string;
      page: number;
    }) {
      return transaction(() => {
        run(
          `INSERT INTO provider_request_logs
             (provider, saved_search_id, property_id, requested_at, purpose, page, status)
           VALUES (?, ?, ?, ?, ?, ?, 'started')`,
          [
            input.provider,
            input.savedSearchId ?? null,
            input.propertyId ?? null,
            now(),
            input.purpose,
            input.page,
          ],
        );
        return lastInsertId();
      });
    },

    finishProviderRequest(
      id: number,
      result: { status: 'succeeded' | 'failed'; resultCount?: number; errorMessage?: string },
    ) {
      transaction(() =>
        run(
          'UPDATE provider_request_logs SET status = ?, result_count = ?, error_message = ? WHERE id = ?',
          [result.status, result.resultCount ?? null, result.errorMessage ?? null, id],
        ),
      );
    },

    listProviderRequestLogs(savedSearchId?: number): ProviderRequestLog[] {
      const rows =
        savedSearchId == null
          ? all('SELECT * FROM provider_request_logs ORDER BY id')
          : all('SELECT * FROM provider_request_logs WHERE saved_search_id = ? ORDER BY id', [
              savedSearchId,
            ]);
      return rows.map((row) => ({
        id: Number(row.id),
        provider: String(row.provider),
        savedSearchId: number(row.saved_search_id),
        propertyId: text(row.property_id),
        requestedAt: String(row.requested_at),
        purpose: String(row.purpose),
        page: Number(row.page),
        status: row.status as ProviderRequestLog['status'],
        resultCount: number(row.result_count),
        errorMessage: text(row.error_message),
      }));
    },

    /** Requests logged at or after `since`. Every logged request counts, whatever its outcome. */
    countProviderRequestsSince(since: string): number {
      return Number(
        one('SELECT COUNT(*) AS total FROM provider_request_logs WHERE requested_at >= ?', [since])
          ?.total,
      );
    },

    countProviderRequestsInPeriod(start: string, next: string): number {
      return Number(
        one(
          'SELECT COUNT(*) AS total FROM provider_request_logs WHERE requested_at >= ? AND requested_at < ?',
          [start, next],
        )?.total,
      );
    },

    countFailedProviderRequestsInPeriod(start: string, next: string): number {
      return Number(
        one(
          "SELECT COUNT(*) AS total FROM provider_request_logs WHERE requested_at >= ? AND requested_at < ? AND status = 'failed'",
          [start, next],
        )?.total,
      );
    },

    listOutsideProviderRequests(): OutsideProviderRequest[] {
      return all('SELECT * FROM outside_provider_requests ORDER BY request_date DESC, id DESC').map(
        (row) => ({
          id: Number(row.id),
          requestDate: String(row.request_date),
          count: Number(row.count),
          note: String(row.note),
          createdAt: String(row.created_at),
        }),
      );
    },

    addOutsideProviderRequest(input: { requestDate: string; count: number; note: string }) {
      return transaction(() => {
        run(
          'INSERT INTO outside_provider_requests (request_date, count, note, created_at) VALUES (?, ?, ?, ?)',
          [input.requestDate, input.count, input.note, now()],
        );
        return lastInsertId();
      });
    },

    deleteOutsideProviderRequest(id: number): boolean {
      return transaction(() => {
        run('DELETE FROM outside_provider_requests WHERE id = ?', [id]);
        return Number(one('SELECT changes() AS total')?.total) > 0;
      });
    },

    /** Requests the search's most recent refresh used, or null if it has never run. */
    lastRefreshRequestCount(searchId: number): number | null {
      const purpose = 'saved-search-refresh';
      const start = one(
        `SELECT MAX(id) AS id FROM provider_request_logs
         WHERE saved_search_id = ? AND purpose = ? AND page = 1`,
        [searchId, purpose],
      )?.id;
      if (start == null) return null;
      return Number(
        one(
          `SELECT COUNT(*) AS total FROM provider_request_logs
           WHERE saved_search_id = ? AND purpose = ? AND id >= ?`,
          [searchId, purpose, start],
        )?.total,
      );
    },

    getSetting(key: string): string | null {
      return text(one('SELECT value FROM app_settings WHERE key = ?', [key])?.value ?? null);
    },

    setSetting(key: string, value: string) {
      transaction(() =>
        run(
          `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [key, value, now()],
        ),
      );
    },

    updateSavedSearch(searchId: number, input: SavedSearchUpdate): SavedSearch {
      return transaction(() => {
        const current = store.getSavedSearch(searchId);
        if (!current) throw new Error('Saved search not found.');
        const next = { ...current, ...input };
        if (next.name.trim().length === 0) throw new Error('Name is required.');
        if (next.location.trim().length === 0) throw new Error('Location is required.');
        if (next.priceMin != null && next.priceMin < 0)
          throw new Error('Minimum price must be 0 or higher.');
        if (next.priceMax != null && next.priceMax < 0)
          throw new Error('Maximum price must be 0 or higher.');
        if (next.priceMin != null && next.priceMax != null && next.priceMin > next.priceMax) {
          throw new Error('Minimum price cannot exceed maximum price.');
        }
        if (next.refreshIntervalDays != null && next.refreshIntervalDays <= 0) {
          throw new Error('Refresh interval must be a positive number of days.');
        }
        if (current.pairedSearchId !== null) {
          const paired = store.getSavedSearch(current.pairedSearchId);
          if (
            paired &&
            (paired.mode === next.mode ||
              paired.location.trim().toLocaleLowerCase('en-US') !==
                next.location.trim().toLocaleLowerCase('en-US'))
          ) {
            throw new Error(
              'Update or unpair the matching search before changing its mode or area.',
            );
          }
        }
        const at = now();
        run(
          `UPDATE saved_searches SET name = ?, mode = ?, location = ?, filters = ?, price_min = ?,
             price_max = ?, refresh_interval_days = ?, updated_at = ? WHERE id = ?`,
          [
            next.name.trim(),
            next.mode,
            next.location.trim(),
            JSON.stringify(next.filters ?? {}),
            next.priceMin ?? null,
            next.priceMax ?? null,
            next.refreshIntervalDays ?? null,
            at,
            searchId,
          ],
        );
        return store.getSavedSearch(searchId)!;
      });
    },

    /** Pairs a Buy search with a Rent search for the same area, in both directions. */
    pairSavedSearches(
      firstId: number,
      secondId: number,
      options: { keepTimestamps?: boolean } = {},
    ) {
      transaction(() => {
        const first = store.getSavedSearch(firstId);
        const second = store.getSavedSearch(secondId);
        if (!first || !second) throw new Error('Both saved searches must exist to pair them');
        if (first.mode === second.mode)
          throw new Error('A pair is one Buy search and one Rent search');
        if (
          first.location.trim().toLocaleLowerCase('en-US') !==
          second.location.trim().toLocaleLowerCase('en-US')
        ) {
          throw new Error('Paired searches must cover the same area.');
        }
        // Unpair anything either search was paired with before.
        run('UPDATE saved_searches SET paired_search_id = NULL WHERE paired_search_id IN (?, ?)', [
          firstId,
          secondId,
        ]);
        // A restored backup keeps each search's own updated time.
        const pairSql = options.keepTimestamps
          ? 'UPDATE saved_searches SET paired_search_id = ?, updated_at = updated_at WHERE id = ?'
          : 'UPDATE saved_searches SET paired_search_id = ?, updated_at = ? WHERE id = ?';
        const stamp = (partnerId: number, searchId: number): SqlValue[] =>
          options.keepTimestamps ? [partnerId, searchId] : [partnerId, now(), searchId];
        run(pairSql, stamp(secondId, firstId));
        run(pairSql, stamp(firstId, secondId));
      });
    },

    unpairSavedSearch(searchId: number) {
      transaction(() => {
        const search = store.getSavedSearch(searchId);
        if (!search) throw new Error('Saved search not found.');
        const pairedId = search.pairedSearchId;
        run('UPDATE saved_searches SET paired_search_id = NULL, updated_at = ? WHERE id = ?', [
          now(),
          searchId,
        ]);
        if (pairedId !== null) {
          run('UPDATE saved_searches SET paired_search_id = NULL, updated_at = ? WHERE id = ?', [
            now(),
            pairedId,
          ]);
        }
      });
    },

    deleteSavedSearch(searchId: number) {
      transaction(() => run('DELETE FROM saved_searches WHERE id = ?', [searchId]));
    },

    // Match review queue

    enqueueMatchReview(item: {
      incomingListing: unknown;
      candidatePropertyId: string;
      reason: string;
    }): ReviewItem {
      return transaction(() => {
        requireProperty(item.candidatePropertyId);
        run(
          'INSERT INTO match_review_queue (incoming_listing, candidate_property_id, reason, created_at) VALUES (?, ?, ?, ?)',
          [JSON.stringify(item.incomingListing), item.candidatePropertyId, item.reason, now()],
        );
        return store.getMatchReview(lastInsertId())!;
      });
    },

    findMatchReview(provider: string, sourceId: string): ReviewItem | null {
      const row = all('SELECT * FROM match_review_queue ORDER BY id DESC').find((entry) => {
        const incoming = JSON.parse(String(entry.incoming_listing)) as ReviewListingInput & {
          provider?: string;
        };
        return incoming.provider === provider && incoming.sourceId === sourceId;
      });
      return row ? toReview(row) : null;
    },

    getMatchReview(reviewId: number): ReviewItem | null {
      const row = one('SELECT * FROM match_review_queue WHERE id = ?', [reviewId]);
      return row ? toReview(row) : null;
    },

    listPendingMatchReviews(): ReviewItem[] {
      return all(
        'SELECT * FROM match_review_queue WHERE decision IS NULL ORDER BY created_at, id',
      ).map(toReview);
    },

    listDecidedMatchReviews(): ReviewItem[] {
      return all(
        'SELECT * FROM match_review_queue WHERE decision IS NOT NULL ORDER BY decided_at, id',
      ).map(toReview);
    },

    /**
     * Records a decision restored from a backup. The incoming listing's price and raw
     * payload are not in a backup, so only its provider, source ID, and address are kept;
     * the next refresh applies the decision to the listing it fetches again.
     */
    restoreMatchDecision(item: {
      provider: string;
      sourceId: string;
      incomingProperty: PropertyInput | null;
      candidatePropertyId: string;
      createdPropertyId: string | null;
      decision: ReviewDecision;
      decidedAt: string;
    }): ReviewItem {
      return transaction(() => {
        requireProperty(item.candidatePropertyId);
        if (item.createdPropertyId) requireProperty(item.createdPropertyId);
        const incoming: RestoredReviewListing = {
          provider: item.provider,
          sourceId: item.sourceId,
          restored: true,
          property: item.incomingProperty,
        };
        run(
          `INSERT INTO match_review_queue (incoming_listing, candidate_property_id, reason, decision,
             decided_at, created_property_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            JSON.stringify(incoming),
            item.candidatePropertyId,
            'restored from backup',
            item.decision,
            item.decidedAt,
            item.createdPropertyId,
            now(),
          ],
        );
        return store.getMatchReview(lastInsertId())!;
      });
    },

    decideMatchReview(reviewId: number, decision: ReviewDecision): ReviewItem {
      return transaction(() => {
        const current = store.getMatchReview(reviewId);
        if (!current) throw new Error(`Unknown review item: ${reviewId}`);
        if (current.decision) throw new Error(`Review item ${reviewId} is already decided`);
        const incoming = current.incomingListing as ReviewListingInput;
        const existingListing = store.getListingByProviderId(incoming.provider, incoming.sourceId);
        if (existingListing)
          throw new Error('Incoming listing is already stored; review cannot create a duplicate');
        let createdPropertyId: string | null = null;
        let propertyId = current.candidatePropertyId;
        if (decision === 'keep_separate') {
          const property = store.createProperty(incoming.property);
          propertyId = property.id;
          createdPropertyId = property.id;
        }
        const listing = store.upsertListing(propertyId, {
          ...incoming.listing,
          provider: incoming.provider,
          providerId: incoming.sourceId,
        });
        store.addSnapshot(listing.id, { price: listing.price, status: listing.status });
        store.addRawPayload(listing.id, incoming.rawPayload);
        run(
          'UPDATE match_review_queue SET decision = ?, decided_at = ?, created_listing_id = ?, created_property_id = ? WHERE id = ?',
          [decision, now(), listing.id, createdPropertyId, reviewId],
        );
        return store.getMatchReview(reviewId)!;
      });
    },

    undoMatchReview(reviewId: number): ReviewItem {
      return transaction(() => {
        const current = store.getMatchReview(reviewId);
        if (!current) throw new Error(`Unknown review item: ${reviewId}`);
        if (!current.decision) throw new Error(`Review item ${reviewId} has no decision to undo`);
        if ((current.incomingListing as Partial<RestoredReviewListing>).restored) {
          throw new Error('A decision restored from a backup cannot be undone.');
        }
        if (current.createdListingId) store.deleteListing(current.createdListingId);
        if (current.createdPropertyId) store.deleteProperty(current.createdPropertyId);
        run(
          'UPDATE match_review_queue SET decision = NULL, decided_at = NULL, created_listing_id = NULL, created_property_id = NULL WHERE id = ?',
          [reviewId],
        );
        return store.getMatchReview(reviewId)!;
      });
    },
  };
  return store;
}

export type Store = ReturnType<typeof createStore>;
