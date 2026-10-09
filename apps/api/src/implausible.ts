import type { ImplausibleFlag, Listing, Property } from './store.js';

const FLORIDA = { minLat: 24.3, maxLat: 31.1, minLng: -87.7, maxLng: -80.0 };

export function findImplausibleFlags(
  property: Property,
  listing: Listing,
  range?: { min: number | null; max: number | null; sample: boolean },
): ImplausibleFlag[] {
  const flags: ImplausibleFlag[] = [];
  const add = (field: string, value: number | string | null, reason: string) =>
    flags.push({ field, value, reason });
  if (listing.price == null || listing.price <= 0)
    add('price', listing.price, 'Missing or invalid listing price.');
  if (property.beds == null) add('beds', null, 'Missing bedroom count.');
  if (property.livingAreaSqft == null || property.livingAreaSqft <= 0)
    add('livingAreaSqft', property.livingAreaSqft, 'Missing or invalid living area.');
  const type = (property.propertyType ?? '').toLowerCase();
  if (property.beds === 0 && (type.includes('single') || type.includes('house')))
    add('beds', property.beds, 'Single-family homes usually have at least one bedroom.');
  if (
    property.latitude != null &&
    (property.latitude < FLORIDA.minLat || property.latitude > FLORIDA.maxLat)
  )
    add('latitude', property.latitude, 'Coordinates fall outside Florida.');
  if (
    property.longitude != null &&
    (property.longitude < FLORIDA.minLng || property.longitude > FLORIDA.maxLng)
  )
    add('longitude', property.longitude, 'Coordinates fall outside Florida.');
  if (
    listing.mode === 'sale' &&
    listing.price != null &&
    property.livingAreaSqft &&
    range?.min != null &&
    range.max != null
  ) {
    const ppsf = Math.round(listing.price / property.livingAreaSqft);
    if (ppsf < range.min || ppsf > range.max) {
      add(
        'livingAreaSqft',
        property.livingAreaSqft,
        `$${ppsf}/sq ft; this area runs about $${range.min}–$${range.max}${range.sample ? ' (sample)' : ''}. The living area or price may be wrong.`,
      );
    }
  }
  return flags;
}
