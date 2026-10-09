import {
  defaultComparableRentRules,
  type ComparableRentFigure,
  type ComparableRentRules,
  type Listing,
  type Property,
  type Store,
} from './store.js';

export interface ComparableRentComp {
  listingId: string;
  propertyId: string;
  address: string;
  beds: number | null;
  livingAreaSqft: number | null;
  distanceMi: number | null;
  rent: number;
  lastSeen: string;
  stale: boolean;
}

export interface ComparableRentResult {
  figure: ComparableRentFigure;
  label: string;
  stale: boolean;
  comps: ComparableRentComp[];
  compsMedian: number | null;
  estimateComps: NonNullable<ComparableRentFigure['estimateComps']>;
}

function active(listing: Listing) {
  return listing.status.trim().toLocaleLowerCase('en-US') === 'active';
}

function monthlyPrice(listing: Listing): number | null {
  if (listing.price == null || listing.pricePeriod === 'total') return null;
  if (listing.pricePeriod === 'month') return listing.price;
  if (listing.pricePeriod === 'week') return Math.round((listing.price * 52) / 12);
  return Math.round(listing.price / 12);
}

function normalizedType(value: string | null) {
  const type = value?.toLocaleLowerCase('en-US').replaceAll('-', '_').replaceAll(' ', '_');
  if (type === 'single_family' || type === 'singlefamily') return 'single_family';
  if (type === 'townhouse') return 'townhome';
  if (type === 'coop') return 'co_op';
  return type;
}

function distanceMiles(left: Property, right: Property): number | null {
  if (
    left.latitude == null ||
    left.longitude == null ||
    right.latitude == null ||
    right.longitude == null
  )
    return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        date,
      );
}

function withinDays(value: string, days: number, now: Date) {
  const timestamp = Date.parse(value.length === 10 ? `${value}T23:59:59Z` : value);
  return Number.isFinite(timestamp) && timestamp >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function coveredByRentSearch(store: Store, property: Property) {
  const cityZip = `${property.city} ${property.zip}`.toLocaleLowerCase('en-US');
  return store.listSavedSearches().some((search) => {
    if (search.mode !== 'rent') return false;
    const location = search.location.toLocaleLowerCase('en-US');
    return (
      location.includes(property.zip) ||
      location.includes(property.city.toLocaleLowerCase('en-US')) ||
      cityZip.includes(location.trim())
    );
  });
}

function collectLocalComps(
  store: Store,
  property: Property,
  propertyId: string,
  rules: ComparableRentRules,
  now: Date,
): ComparableRentComp[] {
  const properties = new Map(store.listProperties().map((item) => [item.id, item]));
  const matching: ComparableRentComp[] = [];
  for (const listing of store.listAllListings()) {
    if (listing.mode !== 'rent' || !active(listing) || listing.propertyId === propertyId) continue;
    const compProperty = properties.get(listing.propertyId);
    const rent = monthlyPrice(listing);
    if (!compProperty || rent === null) continue;
    if (
      rules.sameType &&
      normalizedType(compProperty.propertyType) !== normalizedType(property.propertyType)
    )
      continue;
    if (rules.sameBeds && (property.beds == null || compProperty.beds !== property.beds)) continue;
    if (property.livingAreaSqft == null || compProperty.livingAreaSqft == null) continue;
    const areaDeltaPct =
      (Math.abs(compProperty.livingAreaSqft - property.livingAreaSqft) / property.livingAreaSqft) *
      100;
    if (areaDeltaPct > rules.livingAreaTolerancePct) continue;
    const distanceMi = distanceMiles(property, compProperty);
    if (distanceMi === null || distanceMi > rules.radiusMi) continue;
    const lastSeen = listing.providerLastSeenDate ?? listing.lastFetchedAt;
    if (!withinDays(lastSeen, rules.seenWithinDays, now)) continue;
    matching.push({
      listingId: listing.id,
      propertyId: compProperty.id,
      address: `${compProperty.street}${compProperty.unit ? `, Unit ${compProperty.unit}` : ''}`,
      beds: compProperty.beds,
      livingAreaSqft: compProperty.livingAreaSqft,
      distanceMi,
      rent,
      lastSeen,
      stale: !withinDays(lastSeen, 30, now),
    });
  }
  return matching.sort(
    (left, right) =>
      left.distanceMi! - right.distanceMi! ||
      left.rent - right.rent ||
      left.listingId.localeCompare(right.listingId),
  );
}

export function findComparableRent(
  store: Store,
  propertyId: string,
  rules: ComparableRentRules = store.getComparableRentRules() ?? defaultComparableRentRules,
  now = new Date(),
): ComparableRentResult | null {
  const property = store.getProperty(propertyId);
  if (!property) return null;
  const listings = store.listAllListings();
  const sameHome = listings
    .filter(
      (listing) => listing.propertyId === propertyId && listing.mode === 'rent' && active(listing),
    )
    .map((listing) => ({ listing, value: monthlyPrice(listing) }))
    .filter((item): item is { listing: Listing; value: number } => item.value !== null)
    .sort((left, right) =>
      right.listing.lastFetchedAt.localeCompare(left.listing.lastFetchedAt),
    )[0];
  const computedAt = now.toISOString();
  const matching = collectLocalComps(store, property, propertyId, rules, now);
  const selected = matching.slice(0, Math.max(rules.minComps, matching.length));

  if (sameHome) {
    const seenAt =
      sameHome.listing.providerLastSeenDate ??
      sameHome.listing.providerListedDate ??
      sameHome.listing.lastFetchedAt;
    const stale = !withinDays(seenAt, 30, now);
    const figure: ComparableRentFigure = {
      propertyId,
      source: 'same_home',
      value: sameHome.value,
      low: null,
      high: null,
      reason: null,
      compCount: 1,
      maxDistanceMi: 0,
      compIds: [sameHome.listing.id],
      computedAt,
    };
    store.saveComparableRentFigure(figure);
    return {
      figure,
      label: `same home · listed ${shortDate(sameHome.listing.providerListedDate ?? seenAt)}`,
      stale,
      comps: selected,
      compsMedian: median(selected.map((item) => item.rent)),
      estimateComps: [],
    };
  }
  const savedFigure = store.getComparableRentFigure(propertyId);
  if (matching.length < rules.minComps && savedFigure?.source === 'rent_estimate') {
    const stale = !withinDays(savedFigure.computedAt, 30, now);
    return {
      figure: savedFigure,
      label: `RentCast estimate · range $${savedFigure.low?.toLocaleString() ?? '—'}–$${savedFigure.high?.toLocaleString() ?? '—'} · ${shortDate(savedFigure.computedAt)}`,
      stale,
      comps: [],
      compsMedian: null,
      estimateComps: savedFigure.estimateComps ?? [],
    };
  }
  const covered = coveredByRentSearch(store, property);
  const source = matching.length >= rules.minComps ? 'local_comps' : 'unavailable';
  const compsMedian = median(selected.map((item) => item.rent));
  const value = selected.length < rules.minComps ? null : compsMedian;
  const maxDistanceMi = selected.length
    ? Math.max(...selected.map((item) => item.distanceMi!))
    : null;
  const reason =
    value !== null
      ? null
      : matching.length
        ? `only ${matching.length} local comps`
        : !covered
          ? 'no Rent search covers this area'
          : 'no local comps';
  const figure: ComparableRentFigure = {
    propertyId,
    source,
    value,
    low: null,
    high: null,
    reason,
    compCount: selected.length,
    maxDistanceMi,
    compIds: selected.map((item) => item.listingId),
    computedAt,
  };
  store.saveComparableRentFigure(figure);
  const stale = selected.some((item) => item.stale);
  const label =
    value === null
      ? `Unavailable · ${reason}`
      : `${selected.length} local comps · median · within ${maxDistanceMi!.toFixed(1)} mi`;
  return { figure, label, stale, comps: selected, compsMedian, estimateComps: [] };
}
