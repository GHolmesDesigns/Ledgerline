// Field-coverage report, one block per county and mode, over each search's ACTIVE listings.
// Pure: it reads loaded runs (see runs.mjs) and returns numbers or text.
import { isActive } from './runs.mjs';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const filled = (v) => v != null && String(v).trim() !== '';
const isCondoOrTownhome = (l) => /condo|townhouse|townhome|co-?op/i.test(l.propertyType ?? '');

// A fee of 0 counts as supplied: the provider gave a number.
const hasHoaFee = (l) => typeof l.hoa?.fee === 'number';
const hasMls = (l) => filled(l.mlsNumber);
// A name alone can't be used to reach anyone, so a contact needs a phone or email.
const hasContact = (l) => ['listingAgent', 'listingOffice'].some((k) => filled(l[k]?.phone) || filled(l[k]?.email));
const hasHistory = (l) => Boolean(l.history) && typeof l.history === 'object' && Object.keys(l.history).length > 0;

const share = (listings, test) => ({ n: listings.filter(test).length, of: listings.length });

// Measured against the time of the pull, so rerunning the report later gives the same answer.
function seenWithinWeek(fetchedAt) {
  const pulled = Date.parse(fetchedAt);
  return (l) => {
    const seen = Date.parse(l.lastSeenDate);
    return Number.isFinite(pulled) && Number.isFinite(seen) && pulled - seen <= WEEK_MS;
  };
}

export function coverage(run) {
  return run.searches.map((search) => {
    const active = search.listings.filter(isActive);
    const condoTownhome = search.mode === 'sale' ? active.filter(isCondoOrTownhome) : [];
    return {
      area: run.area,
      county: run.county,
      mode: search.mode,
      runId: run.runId,
      fetchedAt: search.fetchedAt,
      requests: search.requests,
      pages: search.pages.length,
      complete: search.complete,
      stoppedReason: search.stoppedReason,
      returned: search.listings.length,
      active: active.length,
      hoaFee: share(active, hasHoaFee),
      mlsNumber: share(active, hasMls),
      contact: share(active, hasContact),
      mlsOrContact: share(active, (l) => hasMls(l) || hasContact(l)),
      history: share(active, hasHistory),
      seenWithin7Days: share(active, seenWithinWeek(search.fetchedAt)),
      // Sale only. Counts the listings WITHOUT a fee, out of all active condo and townhome sale listings.
      condoTownhomeNoHoa: search.mode === 'sale' ? { n: condoTownhome.filter((l) => !hasHoaFee(l)).length, of: condoTownhome.length } : null,
    };
  });
}

export const formatShare = ({ n, of }) => (of === 0 ? '0/0 (no listings)' : `${n}/${of} (${((100 * n) / of).toFixed(1)}%)`);

function formatRow(row) {
  const lines = [
    `${row.county} · ${row.mode} · run ${row.runId}${row.fetchedAt ? ` · pulled ${row.fetchedAt}` : ''}`,
    `  Requests for this search: ${row.requests} (${row.pages} page${row.pages === 1 ? '' : 's'}${row.complete ? ', complete' : ', INCOMPLETE'})`,
  ];
  if (!row.complete) lines.push(`  WARNING: ${row.stoppedReason ?? 'search did not finish'} Shares below cover only the pages saved.`);
  lines.push(
    `  Listings returned / active: ${row.returned} / ${row.active}`,
    `  With an HOA fee: ${formatShare(row.hoaFee)}`,
    `  With an MLS number: ${formatShare(row.mlsNumber)}`,
    `  With an agent or office contact: ${formatShare(row.contact)}`,
    `  With an MLS number or a contact (plan's verification measure): ${formatShare(row.mlsOrContact)}`,
    `  With history: ${formatShare(row.history)}`,
    `  Last seen within 7 days of the pull: ${formatShare(row.seenWithin7Days)}`,
    row.condoTownhomeNoHoa
      ? `  Condo and townhome sale listings with no HOA fee: ${formatShare(row.condoTownhomeNoHoa)}`
      : '  Condo and townhome sale listings with no HOA fee: not measured for rentals',
  );
  return lines.join('\n');
}

const DEFINITIONS = [
  'Definitions:',
  '  Active: status "Active". Every share is out of the active listings in that search.',
  '  HOA fee: a numeric hoa.fee, including 0.',
  '  Contact: a phone or email on the listing agent or the listing office.',
  '  History: a non-empty history object.',
  '  Last seen within 7 days: lastSeenDate is no more than 7 days before the search was sent.',
  '  Condo and townhome: property type contains condo, townhouse, townhome, or co-op.',
];

export function formatReport(runs) {
  const blocks = runs.flatMap((run) => coverage(run)).map(formatRow);
  return [...blocks, DEFINITIONS.join('\n')].join('\n\n');
}
