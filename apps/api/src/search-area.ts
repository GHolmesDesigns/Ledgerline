const EARTH_RADIUS_MILES = 3958.7613;

export type Coordinates = { latitude: number; longitude: number };

export function isValidZip(value: string) {
  return /^\d{5}$/.test(value);
}

export function isValidCoordinates(point: Coordinates) {
  return (
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function distanceMiles(first: Coordinates, second: Coordinates) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function isWithinRadius(center: Coordinates, point: Coordinates, radiusMiles: number) {
  return distanceMiles(center, point) <= radiusMiles;
}

export function propertyIsWithinRadius(
  center: Coordinates,
  latitude: number | null,
  longitude: number | null,
  radiusMiles: number,
) {
  return (
    latitude !== null &&
    longitude !== null &&
    isWithinRadius(center, { latitude, longitude }, radiusMiles)
  );
}

const suffixes: Record<string, string> = {
  avenue: 'ave',
  boulevard: 'blvd',
  circle: 'cir',
  court: 'ct',
  drive: 'dr',
  lane: 'ln',
  road: 'rd',
  street: 'st',
  terrace: 'ter',
  trail: 'trl',
  north: 'n',
  northeast: 'ne',
  northwest: 'nw',
  south: 's',
  southeast: 'se',
  southwest: 'sw',
  east: 'e',
  west: 'w',
};

export function normalizedAddressText(value: string) {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/\bflorida\b|\bfl\b/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => suffixes[part] ?? part)
    .reduce<string[]>((parts, part) => {
      const prior = parts.at(-1);
      if (prior && ['n', 's'].includes(prior) && ['e', 'w'].includes(part))
        parts[parts.length - 1] = prior + part;
      else parts.push(part);
      return parts;
    }, [])
    .join(' ')
    .replace(/\b(unit|apt|apartment|suite|ste)\s+#?/g, '#')
    .replace(/#\s+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

export function addressMatches(
  query: string,
  property: {
    street: string;
    unit: string | null;
    city: string;
    zip: string;
  },
) {
  const queryText = normalizedAddressText(query);
  const hasUnit = /(?:#|\bunit\b|\bapt(?:artment)?\b|\b(?:suite|ste)\b)/i.test(query);
  const address = normalizedAddressText(
    [
      property.street,
      hasUnit && property.unit ? `Unit ${property.unit}` : '',
      property.city,
      property.zip,
    ]
      .filter(Boolean)
      .join(' '),
  );
  return queryText === address;
}
