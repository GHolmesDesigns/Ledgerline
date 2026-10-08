import type { PropertyInput } from '../store.js';

const streetSuffixes: Record<string, string> = {
  alley: 'aly',
  avenue: 'ave',
  boulevard: 'blvd',
  circle: 'cir',
  court: 'ct',
  drive: 'dr',
  expressway: 'expy',
  highway: 'hwy',
  lane: 'ln',
  parkway: 'pkwy',
  place: 'pl',
  road: 'rd',
  square: 'sq',
  street: 'st',
  terrace: 'ter',
  trail: 'trl',
  turnpike: 'tpke',
  way: 'way',
};

const directions: Record<string, string> = {
  north: 'n',
  northeast: 'ne',
  northwest: 'nw',
  south: 's',
  southeast: 'se',
  southwest: 'sw',
  east: 'e',
  west: 'w',
};

const unitDesignators = new Set(['apt', 'apartment', 'fl', 'floor', 'ste', 'suite', 'unit']);

function tokens(value: string) {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeUnit(value: string | null | undefined) {
  if (!value) return '';
  const parts = tokens(value).filter((part) => part !== '#' && !unitDesignators.has(part));
  return parts.join('').replace(/[^a-z0-9]/g, '');
}

export function normalizeAddress(address: Pick<PropertyInput, 'street' | 'unit' | 'city' | 'zip'>) {
  const parts = tokens(address.street);
  let embeddedUnit = '';
  const markerIndex = parts.findIndex(
    (part, index) => part === '#' || (unitDesignators.has(part) && index > 0),
  );
  if (markerIndex >= 0) {
    embeddedUnit = parts.slice(markerIndex + 1).join('');
    parts.splice(markerIndex);
  } else if (parts.length > 1 && /^#?[0-9][a-z0-9-]*$/i.test(parts.at(-1)!)) {
    const final = parts.at(-1)!;
    if (final.startsWith('#')) {
      embeddedUnit = final.slice(1);
      parts.pop();
    }
  }

  const normalizedStreet = parts.map((part, index) => {
    if (index === 0 && /^\d+[a-z]?$/.test(part)) return part;
    return directions[part] ?? streetSuffixes[part] ?? part;
  });
  // People commonly write NE as either "NE" or "N.E.". The tokenizer makes
  // the latter two tokens, so fold adjacent cardinal directions together.
  for (let index = 0; index < normalizedStreet.length - 1; index += 1) {
    const pair = normalizedStreet[index] + normalizedStreet[index + 1];
    if (['ne', 'nw', 'se', 'sw'].includes(pair)) normalizedStreet.splice(index, 2, pair);
  }

  const city = tokens(address.city).join(' ');
  const zip = String(address.zip).trim().slice(0, 10);
  return {
    street: normalizedStreet.join(' ').trim(),
    unit: normalizeUnit(address.unit) || normalizeUnit(embeddedUnit) || null,
    city,
    zip,
  };
}
