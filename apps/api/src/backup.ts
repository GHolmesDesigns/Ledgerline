import { normalizeAddress } from './providers/normalize-address.js';
import { emptyRiskDetails } from './store.js';
import type {
  ListingMode,
  Property,
  PropertyInput,
  ReviewDecision,
  SavedSearch,
  Store,
  LocalAssumptions,
  PersonalAssumptions,
  PropertyCostEntry,
  PropertyRiskDetails,
} from './store.js';
import { defaultPersonalAssumptions } from './assumptions.js';

// Personal-data backup (C14): notes, saves, dismissals, saved searches, and property
// match decisions in one JSON file. Records are keyed by normalized address and unit,
// never by internal IDs, so a backup can be imported into a database that has never
// seen these properties. Listings, snapshots, raw payloads, and provider credentials
// are deliberately not part of a backup: refresh fetches listings again.

export const BACKUP_FORMAT = 'ledgerline-personal-data';
export const BACKUP_VERSION = 3;

export interface AddressKey {
  street: string;
  unit: string | null;
  city: string;
  zip: string;
}

export interface BackupAddress {
  street: string;
  unit: string | null;
  city: string;
  zip: string;
}

export interface BackupProperty {
  /** Normalized address and unit: the identity of the record. */
  key: AddressKey;
  /** The address as stored, so import can recreate the property. */
  address: BackupAddress;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  floodZone: string | null;
  riskDetails: PropertyRiskDetails;
  sample: boolean;
  saved: { at: string } | null;
  dismissed: { at: string } | null;
  notes: Array<{ body: string; createdAt: string; updatedAt: string }>;
  costEntries: Array<Omit<PropertyCostEntry, 'id' | 'propertyId'>>;
}

export interface BackupSavedSearch {
  name: string;
  mode: ListingMode;
  location: string;
  filters: Record<string, unknown>;
  priceMin: number | null;
  priceMax: number | null;
  refreshIntervalDays: number | null;
  createdAt: string;
  updatedAt: string;
  /** Position in this file's savedSearches of the paired Buy/Rent search, if any. */
  pairedWith: number | null;
  personalAssumptions: PersonalAssumptions | null;
}

export interface BackupMatchDecision {
  provider: string;
  sourceId: string;
  decision: ReviewDecision;
  decidedAt: string;
  /** The existing property the incoming listing was compared with. */
  candidate: AddressKey;
  /** For Keep separate: the property created for the incoming listing. */
  createdProperty: AddressKey | null;
  incomingAddress: BackupAddress | null;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  properties: BackupProperty[];
  savedSearches: BackupSavedSearch[];
  localAssumptions: LocalAssumptions[];
  matchDecisions: BackupMatchDecision[];
}

/** A problem with the file as a whole. Nothing is changed when one is raised. */
export class BackupError extends Error {}

const idOf = (key: AddressKey) => JSON.stringify([key.street, key.unit ?? '', key.city, key.zip]);

function keyOf(address: BackupAddress): AddressKey {
  return normalizeAddress(address);
}

function addressOf(property: Pick<Property, 'street' | 'unit' | 'city' | 'zip'>): BackupAddress {
  return {
    street: property.street,
    unit: property.unit,
    city: property.city,
    zip: property.zip,
  };
}

export function exportBackup(store: Store, exportedAt = new Date()): Backup {
  const properties = new Map<string, BackupProperty>();
  const byLocalId = new Map<string, BackupProperty>();
  const include = (propertyId: string) => {
    const existing = byLocalId.get(propertyId);
    if (existing) return existing;
    const property = store.getProperty(propertyId);
    if (!property) return null;
    const record: BackupProperty = {
      key: keyOf(property),
      address: addressOf(property),
      county: property.county,
      latitude: property.latitude,
      longitude: property.longitude,
      floodZone: property.floodZone,
      riskDetails: property.riskDetails,
      sample: property.sample,
      saved: null,
      dismissed: null,
      notes: store.listNotes(propertyId).map((note) => ({
        body: note.body,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
      costEntries: store.listCostEntries(propertyId).map((entry) => ({
        kind: entry.kind,
        amount: entry.amount,
        state: entry.state,
        source: entry.source,
        date: entry.date,
        assessmentStatus: entry.assessmentStatus,
        paymentType: entry.paymentType,
        amountUnknown: entry.amountUnknown,
        sample: entry.sample,
      })),
    };
    properties.set(idOf(record.key), record);
    byLocalId.set(propertyId, record);
    return record;
  };

  for (const property of store.listProperties()) {
    if (
      store.listNotes(property.id).length > 0 ||
      store.listCostEntries(property.id).length > 0 ||
      Object.values(property.riskDetails).some((value) =>
        Array.isArray(value) ? value.length > 0 : value !== null,
      )
    )
      include(property.id);
  }
  for (const favorite of store.listFavorites()) {
    const record = include(favorite.propertyId);
    if (record) record.saved = { at: favorite.createdAt };
  }
  for (const dismissal of store.listDismissals()) {
    const record = include(dismissal.propertyId);
    if (record) record.dismissed = { at: dismissal.dismissedAt };
  }

  const matchDecisions: BackupMatchDecision[] = [];
  for (const review of store.listDecidedMatchReviews()) {
    const incoming = review.incomingListing as {
      provider?: unknown;
      sourceId?: unknown;
      property?: PropertyInput | null;
    };
    if (typeof incoming.provider !== 'string' || typeof incoming.sourceId !== 'string') continue;
    const candidate = include(review.candidatePropertyId);
    if (!candidate) continue;
    let createdProperty: BackupProperty | null = null;
    if (review.decision === 'keep_separate') {
      // The created property is gone if the user deleted it; there is nothing to restore.
      createdProperty = review.createdPropertyId ? include(review.createdPropertyId) : null;
      if (!createdProperty) continue;
    }
    matchDecisions.push({
      provider: incoming.provider,
      sourceId: incoming.sourceId,
      decision: review.decision!,
      decidedAt: review.decidedAt!,
      candidate: candidate.key,
      createdProperty: createdProperty?.key ?? null,
      incomingAddress: incoming.property
        ? {
            street: incoming.property.street,
            unit: incoming.property.unit ?? null,
            city: incoming.property.city,
            zip: incoming.property.zip,
          }
        : null,
    });
  }

  const searches = store.listSavedSearches();
  const positions = new Map(searches.map((search, index) => [search.id, index]));
  const savedSearches: BackupSavedSearch[] = searches.map((search) => ({
    name: search.name,
    mode: search.mode,
    location: search.location,
    filters: search.filters,
    priceMin: search.priceMin,
    priceMax: search.priceMax,
    refreshIntervalDays: search.refreshIntervalDays,
    createdAt: search.createdAt,
    updatedAt: search.updatedAt,
    pairedWith:
      search.pairedSearchId === null ? null : (positions.get(search.pairedSearchId) ?? null),
    personalAssumptions: store.getPersonalAssumptions(search.id),
  }));

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    properties: [...properties.values()].sort((left, right) =>
      idOf(left.key).localeCompare(idOf(right.key)),
    ),
    savedSearches,
    localAssumptions: store.listLocalAssumptions(),
    matchDecisions,
  };
}

export type BackupMigration = (data: Record<string, unknown>) => Record<string, unknown>;

export interface BackupMigrationOptions {
  currentVersion?: number;
  /** steps[n] upgrades a version-n file to version n + 1. */
  steps?: Record<number, BackupMigration>;
}

// Format 1 is the first format, so no older format exists yet. When the format changes,
// bump BACKUP_VERSION and add the step that upgrades the previous version here.
const migrationSteps: Record<number, BackupMigration> = {
  1: (data) => ({
    ...data,
    savedSearches: (Array.isArray(data.savedSearches) ? data.savedSearches : []).map((item) =>
      isRecord(item) ? { ...item, personalAssumptions: null } : item,
    ),
    localAssumptions: [],
  }),
  2: (data) => ({
    ...data,
    properties: Array.isArray(data.properties)
      ? data.properties.map((item) =>
          isRecord(item)
            ? { ...item, costEntries: Array.isArray(item.costEntries) ? item.costEntries : [] }
            : item,
        )
      : data.properties,
  }),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function readRiskDetails(value: unknown): PropertyRiskDetails {
  if (!isRecord(value)) return { ...emptyRiskDetails };
  const nullableText = (key: string) => (isText(value[key]) ? value[key].trim() || null : null);
  const roofYear = value.roofYear;
  const assessmentAmount = value.assessmentAmount;
  const mitigation = Array.isArray(value.windMitigation)
    ? value.windMitigation.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    floodZoneSource: nullableText('floodZoneSource'),
    floodZoneDate: nullableText('floodZoneDate'),
    roofYear:
      typeof roofYear === 'number' && Number.isInteger(roofYear) && roofYear >= 1800
        ? roofYear
        : null,
    windMitigation: [...new Set(mitigation)],
    insuranceSource: nullableText('insuranceSource'),
    insuranceDate: nullableText('insuranceDate'),
    milestoneInspection: nullableText('milestoneInspection'),
    countyRecertification: nullableText('countyRecertification'),
    reserveStudy: nullableText('reserveStudy'),
    specialAssessment: nullableText('specialAssessment'),
    assessmentAmount:
      typeof assessmentAmount === 'number' &&
      Number.isFinite(assessmentAmount) &&
      assessmentAmount >= 0
        ? assessmentAmount
        : null,
    assessmentPaymentType:
      value.assessmentPaymentType === 'one_time' || value.assessmentPaymentType === 'installments'
        ? value.assessmentPaymentType
        : null,
    rentalRestrictions: nullableText('rentalRestrictions'),
    approvalRestrictions: nullableText('approvalRestrictions'),
    associationSource: nullableText('associationSource'),
    associationDate: nullableText('associationDate'),
  };
}

/**
 * Checks the file's format and brings an older version up to the current one.
 * A newer or unknown version is refused, so an old app never half-reads a new file.
 */
export function migrateBackup(
  raw: unknown,
  options: BackupMigrationOptions = {},
): { data: Record<string, unknown>; fromVersion: number } {
  const currentVersion = options.currentVersion ?? BACKUP_VERSION;
  const steps = options.steps ?? migrationSteps;
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupError('This file is not a Ledgerline personal-data backup.');
  }
  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupError('This backup has no valid format version.');
  }
  if (version > currentVersion) {
    throw new BackupError(
      `This backup uses format version ${version}, which is newer than this version of Ledgerline understands (${currentVersion}). Update Ledgerline, then import it again. Nothing was changed.`,
    );
  }
  let data = raw;
  for (let step = version; step < currentVersion; step += 1) {
    const migrate = steps[step];
    if (!migrate) {
      throw new BackupError(
        `This backup uses format version ${version}, and there is no way to upgrade it to version ${currentVersion}. Nothing was changed.`,
      );
    }
    data = { ...migrate(data), format: BACKUP_FORMAT, formatVersion: step + 1 };
  }
  return { data, fromVersion: version };
}

export interface ImportCounts {
  properties: number;
  notes: number;
  saved: number;
  dismissed: number;
  savedSearches: number;
  matchDecisions: number;
  personalAssumptions: number;
  localAssumptions: number;
  costEntries: number;
}

export interface SkippedRecord {
  section:
    | 'properties'
    | 'notes'
    | 'savedSearches'
    | 'matchDecisions'
    | 'localAssumptions'
    | 'costEntries';
  label: string;
  reason: string;
}

export interface ImportReport {
  formatVersion: number;
  migratedFromVersion: number | null;
  exportedAt: string | null;
  added: ImportCounts;
  alreadyPresent: ImportCounts;
  skipped: SkippedRecord[];
}

const emptyCounts = (): ImportCounts => ({
  properties: 0,
  notes: 0,
  saved: 0,
  dismissed: 0,
  savedSearches: 0,
  matchDecisions: 0,
  personalAssumptions: 0,
  localAssumptions: 0,
  costEntries: 0,
});

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const nullableNumber = (value: unknown) =>
  value === undefined || value === null
    ? null
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
const nullableText = (value: unknown) =>
  value === undefined || value === null ? null : typeof value === 'string' ? value : undefined;

function readAddress(value: unknown): BackupAddress | null {
  if (!isRecord(value) || !isText(value.street) || !isText(value.city) || !isText(value.zip)) {
    return null;
  }
  const unit = nullableText(value.unit);
  if (unit === undefined) return null;
  return { street: value.street, unit, city: value.city, zip: value.zip };
}

function readKey(value: unknown): AddressKey | null {
  const address = readAddress(value);
  return address && { ...address };
}

const describeAddress = (address: BackupAddress | null) =>
  address
    ? `${address.street}${address.unit ? `, Unit ${address.unit}` : ''}, ${address.city}`
    : '';

const searchIdentity = (search: { mode: string; name: string; location: string }) =>
  [search.mode, search.name.trim().toLowerCase(), search.location.trim().toLowerCase()].join('|');

/**
 * Merges a backup into the database. Properties are matched by normalized address and
 * unit; what the database already holds is kept, and only what is missing is added, so
 * importing the same file twice changes nothing. A record that cannot be read is skipped
 * and reported. A file that is not a backup, or is too new, is refused before any change.
 */
export function importBackup(
  store: Store,
  raw: unknown,
  options: BackupMigrationOptions = {},
): ImportReport {
  const { data, fromVersion } = migrateBackup(raw, options);
  for (const section of [
    'properties',
    'savedSearches',
    'matchDecisions',
    'localAssumptions',
  ] as const) {
    if (data[section] !== undefined && !Array.isArray(data[section])) {
      throw new BackupError(`The backup's ${section} section is not a list. Nothing was changed.`);
    }
  }

  const added = emptyCounts();
  const alreadyPresent = emptyCounts();
  const skipped: SkippedRecord[] = [];

  store.transaction(() => {
    const local = new Map<string, Property>();
    for (const property of store.listProperties()) local.set(idOf(keyOf(property)), property);
    // Properties of this file, by key, once they exist in the database.
    const resolved = new Map<string, Property>();

    for (const item of (data.properties as unknown[] | undefined) ?? []) {
      const record = isRecord(item) ? item : {};
      const address = readAddress(record.address);
      const key = readKey(record.key);
      const label = describeAddress(address ?? key) || 'Unreadable property';
      if (!address || !key) {
        skipped.push({
          section: 'properties',
          label,
          reason: 'The address is missing or unreadable.',
        });
        continue;
      }
      if (idOf(keyOf(address)) !== idOf(key)) {
        skipped.push({
          section: 'properties',
          label,
          reason: 'The record key does not match its address.',
        });
        continue;
      }
      const latitude = nullableNumber(record.latitude);
      const longitude = nullableNumber(record.longitude);
      const county = nullableText(record.county);
      if (latitude === undefined || longitude === undefined || county === undefined) {
        skipped.push({ section: 'properties', label, reason: 'The location is unreadable.' });
        continue;
      }

      let property = local.get(idOf(key));
      if (property) {
        alreadyPresent.properties += 1;
        const restoredRisk = readRiskDetails(record.riskDetails);
        const mergedRisk = { ...property.riskDetails } as PropertyRiskDetails;
        for (const [key, value] of Object.entries(restoredRisk) as Array<
          [keyof PropertyRiskDetails, PropertyRiskDetails[keyof PropertyRiskDetails]]
        >) {
          const current = mergedRisk[key];
          if (current == null || (Array.isArray(current) && current.length === 0)) {
            (mergedRisk as unknown as Record<string, unknown>)[key] = value;
          }
        }
        const floodZone = property.floodZone ?? nullableText(record.floodZone) ?? null;
        if (
          JSON.stringify(mergedRisk) !== JSON.stringify(property.riskDetails) ||
          floodZone !== property.floodZone
        ) {
          property = store.updateRiskDetails(property.id, floodZone, mergedRisk);
          local.set(idOf(key), property);
        }
      } else {
        property = store.createProperty({
          ...address,
          county,
          latitude,
          longitude,
          floodZone: nullableText(record.floodZone) ?? null,
          riskDetails: readRiskDetails(record.riskDetails),
          sample: record.sample === true,
        });
        local.set(idOf(key), property);
        added.properties += 1;
      }
      resolved.set(idOf(key), property);

      const saved = isRecord(record.saved) ? record.saved : null;
      if (saved) {
        if (store.isFavorite(property.id)) alreadyPresent.saved += 1;
        else {
          store.setFavorite(property.id, true, isTimestamp(saved.at) ? saved.at : undefined);
          added.saved += 1;
        }
      }
      const dismissed = isRecord(record.dismissed) ? record.dismissed : null;
      if (dismissed) {
        if (store.isDismissed(property.id)) alreadyPresent.dismissed += 1;
        else {
          store.setDismissed(
            property.id,
            true,
            isTimestamp(dismissed.at) ? dismissed.at : undefined,
          );
          added.dismissed += 1;
        }
      }

      const have = new Set(
        store.listNotes(property.id).map((note) => `${note.createdAt}|${note.body}`),
      );
      for (const note of Array.isArray(record.notes) ? (record.notes as unknown[]) : []) {
        if (!isRecord(note) || !isText(note.body) || !isTimestamp(note.createdAt)) {
          skipped.push({
            section: 'notes',
            label,
            reason: 'A note has no text or no date and was not imported.',
          });
          continue;
        }
        const identity = `${note.createdAt}|${note.body.trim()}`;
        if (have.has(identity)) {
          alreadyPresent.notes += 1;
          continue;
        }
        store.addNote(property.id, note.body.trim(), {
          createdAt: note.createdAt,
          updatedAt: isTimestamp(note.updatedAt) ? note.updatedAt : note.createdAt,
        });
        have.add(identity);
        added.notes += 1;
      }
      const knownEntries = new Set(
        store
          .listCostEntries(property.id)
          .map((entry) => JSON.stringify([entry.kind, entry.date, entry.source, entry.amount])),
      );
      for (const rawEntry of Array.isArray(record.costEntries) ? record.costEntries : []) {
        if (
          !isRecord(rawEntry) ||
          !isText(rawEntry.kind) ||
          ![
            'homeowners_quote',
            'ho6_quote',
            'flood_quote',
            'tax_bill',
            'tax_bill_cdd',
            'association_fee',
            'special_assessment',
            'hoa_none',
            'flood_not_carried',
          ].includes(rawEntry.kind) ||
          !['Quote', 'Doc', 'N/A'].includes(String(rawEntry.state)) ||
          !isText(rawEntry.source) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(rawEntry.date))
        ) {
          skipped.push({ section: 'costEntries', label, reason: 'A cost record is unreadable.' });
          continue;
        }
        const amount = nullableNumber(rawEntry.amount);
        if (amount === undefined || (amount !== null && amount < 0)) {
          skipped.push({
            section: 'costEntries',
            label,
            reason: 'A cost record amount is invalid.',
          });
          continue;
        }
        const identity = JSON.stringify([rawEntry.kind, rawEntry.date, rawEntry.source, amount]);
        if (knownEntries.has(identity)) {
          alreadyPresent.costEntries += 1;
          continue;
        }
        store.addCostEntry(property.id, {
          kind: rawEntry.kind as import('./store.js').CostEntryKind,
          amount,
          state: rawEntry.state as import('./store.js').CostEntryState,
          source: rawEntry.source,
          date: rawEntry.date as string,
          assessmentStatus:
            rawEntry.assessmentStatus === 'pending' || rawEntry.assessmentStatus === 'approved'
              ? rawEntry.assessmentStatus
              : null,
          paymentType:
            rawEntry.paymentType === 'one_time' || rawEntry.paymentType === 'installments'
              ? rawEntry.paymentType
              : null,
          amountUnknown: rawEntry.amountUnknown === true,
          sample: rawEntry.sample === true,
        });
        knownEntries.add(identity);
        added.costEntries += 1;
      }
    }

    const existingSearches = new Map<string, SavedSearch>();
    for (const search of store.listSavedSearches()) {
      const identity = searchIdentity(search);
      if (!existingSearches.has(identity)) existingSearches.set(identity, search);
    }
    const searchItems = ((data.savedSearches as unknown[] | undefined) ?? []).map((item) =>
      isRecord(item) ? item : {},
    );
    const localSearchIds = new Map<number, number>();
    searchItems.forEach((record, index) => {
      const label = isText(record.name) ? record.name : 'Unreadable saved search';
      const priceMin = nullableNumber(record.priceMin);
      const priceMax = nullableNumber(record.priceMax);
      const interval = nullableNumber(record.refreshIntervalDays);
      const filters = record.filters ?? {};
      const problem =
        !isText(record.name) || !isText(record.location)
          ? 'The name or area is missing.'
          : record.mode !== 'sale' && record.mode !== 'rent'
            ? 'The mode is not Buy or Rent.'
            : priceMin === undefined ||
                priceMax === undefined ||
                (priceMin !== null && priceMin < 0) ||
                (priceMax !== null && priceMax < 0) ||
                (priceMin !== null && priceMax !== null && priceMin > priceMax)
              ? 'The price range is not valid.'
              : interval === undefined ||
                  (interval !== null && (!Number.isInteger(interval) || interval <= 0))
                ? 'The refresh interval is not valid.'
                : !isRecord(filters)
                  ? 'The filters are unreadable.'
                  : null;
      if (problem) {
        skipped.push({ section: 'savedSearches', label, reason: problem });
        return;
      }
      const input = {
        name: (record.name as string).trim(),
        mode: record.mode as ListingMode,
        location: (record.location as string).trim(),
        filters: filters as Record<string, unknown>,
        priceMin,
        priceMax,
        refreshIntervalDays: interval,
      };
      const identity = searchIdentity(input);
      const existing = existingSearches.get(identity);
      if (existing) {
        alreadyPresent.savedSearches += 1;
        localSearchIds.set(index, existing.id);
        const personal = readPersonalAssumptions(record.personalAssumptions);
        if (personal) {
          const current = store.getPersonalAssumptions(existing.id);
          const currentIsDefault =
            current &&
            current.downPaymentPct === defaultPersonalAssumptions.downPaymentPct &&
            current.mortgageRatePct === defaultPersonalAssumptions.mortgageRatePct &&
            current.termYears === defaultPersonalAssumptions.termYears &&
            current.maintenancePctPerYear === defaultPersonalAssumptions.maintenancePctPerYear;
          const sameAsBackup =
            current &&
            current.downPaymentPct === personal.downPaymentPct &&
            current.mortgageRatePct === personal.mortgageRatePct &&
            current.termYears === personal.termYears &&
            current.maintenancePctPerYear === personal.maintenancePctPerYear;
          if (!current || (currentIsDefault && !sameAsBackup)) {
            store.setPersonalAssumptions(existing.id, personal);
            added.personalAssumptions += 1;
          } else alreadyPresent.personalAssumptions += 1;
        }
        return;
      }
      const created = store.createSavedSearch(input, {
        createdAt: isTimestamp(record.createdAt) ? record.createdAt : undefined,
        updatedAt: isTimestamp(record.updatedAt) ? record.updatedAt : undefined,
      });
      existingSearches.set(identity, created);
      localSearchIds.set(index, created.id);
      added.savedSearches += 1;
      const personal = readPersonalAssumptions(record.personalAssumptions);
      if (personal) {
        store.setPersonalAssumptions(created.id, personal);
        added.personalAssumptions += 1;
      }
    });
    const localRows = store.listLocalAssumptions();
    const existingLocal = new Set(localRows.map((item) => item.county.toLocaleLowerCase('en-US')));
    for (const item of (data.localAssumptions as unknown[] | undefined) ?? []) {
      const record = readLocalAssumptions(item);
      if (!record) {
        skipped.push({
          section: 'localAssumptions',
          label: 'Local rates',
          reason: 'The county rates are unreadable.',
        });
        continue;
      }
      const key = record.county.toLocaleLowerCase('en-US');
      const current = localRows.find((entry) => entry.county.toLocaleLowerCase('en-US') === key);
      if (!current || (current.sample && !record.sample)) {
        store.setLocalAssumption(record);
        existingLocal.add(key);
        added.localAssumptions += 1;
      } else alreadyPresent.localAssumptions += 1;
    }
    // Restore Buy/Rent pairs, but never break a pairing the database already has.
    searchItems.forEach((record, index) => {
      const partner = record.pairedWith;
      const first = localSearchIds.get(index);
      const second = typeof partner === 'number' ? localSearchIds.get(partner) : undefined;
      if (first === undefined || second === undefined || first === second) return;
      const firstSearch = store.getSavedSearch(first);
      const secondSearch = store.getSavedSearch(second);
      if (firstSearch?.pairedSearchId !== null || secondSearch?.pairedSearchId !== null) return;
      try {
        store.pairSavedSearches(first, second, { keepTimestamps: true });
      } catch (error) {
        skipped.push({
          section: 'savedSearches',
          label: firstSearch ? firstSearch.name : 'Saved search',
          reason: `The Buy/Rent pairing was not restored: ${
            error instanceof Error ? error.message : 'invalid pair'
          }`,
        });
      }
    });

    for (const item of (data.matchDecisions as unknown[] | undefined) ?? []) {
      const record = isRecord(item) ? item : {};
      const incomingAddress = readAddress(record.incomingAddress);
      const label =
        describeAddress(incomingAddress) ||
        `${String(record.provider ?? 'Unknown provider')} ${String(record.sourceId ?? '')}`.trim();
      const candidateKey = readKey(record.candidate);
      const createdKey = record.createdProperty == null ? null : readKey(record.createdProperty);
      const decision = record.decision;
      const problem =
        !isText(record.provider) || !isText(record.sourceId)
          ? 'The listing it refers to is missing.'
          : decision !== 'link' && decision !== 'keep_separate'
            ? 'The decision is not Link or Keep separate.'
            : !isTimestamp(record.decidedAt)
              ? 'The decision has no valid date.'
              : !candidateKey || !resolved.has(idOf(candidateKey))
                ? 'The existing property it was compared with is not in the backup.'
                : decision === 'keep_separate' && (!createdKey || !resolved.has(idOf(createdKey)))
                  ? 'The separate property it created is not in the backup.'
                  : null;
      if (problem) {
        skipped.push({ section: 'matchDecisions', label, reason: problem });
        continue;
      }
      const existing = store.findMatchReview(record.provider as string, record.sourceId as string);
      if (existing) {
        if (existing.decision) alreadyPresent.matchDecisions += 1;
        else {
          skipped.push({
            section: 'matchDecisions',
            label,
            reason: 'This listing is already waiting in the review queue; decide it there.',
          });
        }
        continue;
      }
      store.restoreMatchDecision({
        provider: record.provider as string,
        sourceId: record.sourceId as string,
        incomingProperty: incomingAddress,
        candidatePropertyId: resolved.get(idOf(candidateKey!))!.id,
        createdPropertyId:
          decision === 'keep_separate' ? resolved.get(idOf(createdKey!))!.id : null,
        decision: decision as ReviewDecision,
        decidedAt: record.decidedAt as string,
      });
      added.matchDecisions += 1;
    }
  });

  return {
    formatVersion: BACKUP_VERSION,
    migratedFromVersion:
      fromVersion === (options.currentVersion ?? BACKUP_VERSION) ? null : fromVersion,
    exportedAt: isTimestamp(data.exportedAt) ? data.exportedAt : null,
    added,
    alreadyPresent,
    skipped,
  };
}

function readPersonalAssumptions(value: unknown): PersonalAssumptions | null {
  if (!isRecord(value)) return null;
  const fields = [
    value.downPaymentPct,
    value.mortgageRatePct,
    value.termYears,
    value.maintenancePctPerYear,
  ];
  if (fields.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return null;
  return {
    downPaymentPct: value.downPaymentPct as number,
    mortgageRatePct: value.mortgageRatePct as number,
    termYears: value.termYears as number,
    maintenancePctPerYear: value.maintenancePctPerYear as number,
    ...(isTimestamp(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
  };
}

function readLocalAssumptions(value: unknown): LocalAssumptions | null {
  if (!isRecord(value) || !isText(value.county) || typeof value.set !== 'boolean') return null;
  const numberOrNull = (item: unknown) =>
    item === null ? null : typeof item === 'number' && Number.isFinite(item) ? item : undefined;
  const millage = numberOrNull(value.millage);
  const typical = numberOrNull(value.typicalNonAdValoremPerYear);
  const homeowners = numberOrNull(value.homeownersDefaultMonthly);
  const ho6 = numberOrNull(value.ho6DefaultMonthly);
  const flood = value.floodDefaultMonthly;
  if (
    millage === undefined ||
    typical === undefined ||
    homeowners === undefined ||
    ho6 === undefined ||
    !isRecord(flood)
  )
    return null;
  if (Object.values(flood).some((item) => typeof item !== 'number' || !Number.isFinite(item)))
    return null;
  const source = nullableText(value.source);
  const setOn = nullableText(value.setOn);
  if (
    source === undefined ||
    setOn === undefined ||
    (value.set && (!source || !setOn || millage === null))
  )
    return null;
  return {
    county: value.county.trim(),
    set: value.set,
    millage,
    typicalNonAdValoremPerYear: typical,
    homeownersDefaultMonthly: homeowners,
    ho6DefaultMonthly: ho6,
    floodDefaultMonthly: flood as Record<string, number>,
    source,
    setOn,
    sample: value.sample === true,
  };
}
