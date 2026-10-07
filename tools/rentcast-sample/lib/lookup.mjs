// Finds saved provider listings for a property seen on a public site (coverage check, plan step 3).
// It lists candidates and says how each lines up; whether the property is "found" is the plan's rule, applied
// by hand: same normalized address and unit, same mode, and for a record with no unit, matching beds and area.
const WORDS = new Map(Object.entries({
  avenue: 'ave', av: 'ave', street: 'st', road: 'rd', boulevard: 'blvd', drive: 'dr', court: 'ct', lane: 'ln', place: 'pl',
  terrace: 'ter', highway: 'hwy', parkway: 'pkwy', circle: 'cir', trail: 'trl', way: 'way',
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
}));
const UNIT_WORDS = new Set(['apt', 'apartment', 'unit', 'suite', 'ste', 'no', 'number']);

// "1042 N.E. 3rd Avenue" -> ['1042', 'ne', '3rd', 'ave']
export function streetTokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => WORDS.get(t) ?? t);
}

// "Apt 2B", "#2b", "Unit 2B" and "2B" are the same unit; "Ph 8" stays "ph8".
export function unitKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/#/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !UNIT_WORDS.has(t))
    .join('');
}

const subset = (small, big) => small.every((t) => big.includes(t));

// How the street lines compare: 'exact', 'partial' (one has the other's words plus more, such as a missing
// street suffix), or null. The house number must be the same.
function streetMatch(query, listing) {
  if (!query.length || !listing.length || query[0] !== listing[0]) return null;
  if (query.length === listing.length && subset(query, listing)) return 'exact';
  return subset(query, listing) || subset(listing, query) ? 'partial' : null;
}

function unitMatch(wanted, listingUnit) {
  const have = unitKey(listingUnit);
  if (!have) return 'listing has no unit';
  if (!wanted) return 'no unit given';
  return have === wanted ? 'same' : 'different';
}

const RANK = { same: 0, 'listing has no unit': 1, 'no unit given': 2, different: 3 };

// `address` may be a whole address; only the part before the first comma is the street line.
export function findCandidates(runs, { address, unit = '', mode = null, beds = null, sqft = null }) {
  const street = streetTokens(String(address).split(',')[0]);
  const wanted = unitKey(unit);
  const out = [];
  for (const run of runs) {
    for (const search of run.searches) {
      if (mode && search.mode !== mode) continue;
      for (const l of search.listings) {
        const streetResult = streetMatch(street, streetTokens(l.addressLine1));
        if (!streetResult) continue;
        const bedsMatch = beds == null || l.bedrooms == null ? null : Number(l.bedrooms) === Number(beds);
        out.push({
          county: run.county, mode: search.mode, runId: run.runId, id: l.id, mlsNumber: l.mlsNumber ?? null,
          status: l.status, price: l.price ?? null, street: streetResult, unit: unitMatch(wanted, l.addressLine2),
          addressLine1: l.addressLine1, addressLine2: l.addressLine2 ?? null, propertyType: l.propertyType ?? null,
          bedrooms: l.bedrooms ?? null, squareFootage: l.squareFootage ?? null, bedsMatch, sqftGiven: sqft,
        });
      }
    }
  }
  return out.sort((a, b) => RANK[a.unit] - RANK[b.unit] || (a.street === 'exact' ? 0 : 1) - (b.street === 'exact' ? 0 : 1));
}

const dollars = (v) => (v == null ? 'no price' : `$${Number(v).toLocaleString('en-US')}`);

export function formatCandidates(candidates, { address, unit = '', mode = null }) {
  const header = `Looking for: ${address}${unit ? `, unit ${unit}` : ''}${mode ? `, ${mode} only` : ''}`;
  if (!candidates.length) {
    return [header, '', 'No saved listing has that house number and street name.', 'Under the plan\'s rule that is "Not found" (the saved pull holds active listings only, in the area and filters you pulled).'].join('\n');
  }
  const lines = [header, `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}, best match first. You decide which, if any, is the same property.`];
  candidates.forEach((c, i) => {
    const unitNote = { same: 'unit matches', 'listing has no unit': 'listing has no unit: Found only if beds and living area match the public listing', 'no unit given': 'you gave no unit', different: 'a DIFFERENT unit in this building' }[c.unit];
    const detail = [c.propertyType, c.bedrooms != null ? `${c.bedrooms} bd` : null, c.squareFootage != null ? `${Number(c.squareFootage).toLocaleString('en-US')} sqft` : null].filter(Boolean).join(', ');
    lines.push(
      '',
      `${i + 1}. ${c.addressLine1}${c.addressLine2 ? `, ${c.addressLine2}` : ''}   (${c.county}, ${c.mode}, street ${c.street}, ${unitNote})`,
      `   provider_id ${c.id}   mls_number ${c.mlsNumber ?? 'none'}   provider_status ${c.status}   provider_price ${dollars(c.price)}`,
      `   ${detail || 'no property details'}${c.bedsMatch === true ? '   beds match' : c.bedsMatch === false ? '   beds DIFFER from the public listing' : ''}${c.sqftGiven != null && c.squareFootage != null ? `   living area here ${Number(c.squareFootage).toLocaleString('en-US')} vs ${Number(c.sqftGiven).toLocaleString('en-US')} public` : ''}`,
    );
  });
  return lines.join('\n');
}
