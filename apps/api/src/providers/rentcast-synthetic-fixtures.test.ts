import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

interface SyntheticListing {
  id: string;
  addressLine1: string;
  zipCode: string;
  county: string;
  propertyType: string;
  status: string;
  price: number;
}

interface SyntheticFixtureFile {
  _readme: string;
  label: string;
  sale: SyntheticListing[];
  rental: SyntheticListing[];
  coverage: Record<string, string[]>;
}

const fixturePath = fileURLToPath(
  new URL('../../../../fixtures/rentcast-synthetic-listings.json', import.meta.url),
);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as SyntheticFixtureFile;

const requiredCoverage = [
  'sale_and_rent',
  'houses',
  'high_rise_condo_with_unit',
  'older_condo_with_unit',
  'same_property_sale_and_rent',
  'status_and_price_changes',
  'missing_fields',
  'implausible_values',
  'duplicate_address',
  'ambiguous_unit_match',
  'flood_x',
  'flood_ae',
  'flood_ve',
  'assessment_pending_without_amount',
  'fewer_than_three_rent_comps',
  'outside_configured_markets',
  'home_in_cdd',
  'single_family_without_hoa_data',
  'same_building_units_without_hoa_fee',
  'verified_zero_cdd',
  'not_applicable_no_association',
];

describe('synthetic RentCast fixture set', () => {
  it('covers each plan scenario with one or more fixture listings', () => {
    const allListings = [...fixtures.sale, ...fixtures.rental];
    const ids = new Set(allListings.map((listing) => listing.id));

    assert.match(fixtures._readme, /SYNTHETIC FIXTURES/);
    assert.equal(fixtures.label, 'Sample data — not real listings');
    assert.ok(allListings.length >= 30 && allListings.length <= 50);
    assert.deepEqual(Object.keys(fixtures.coverage).sort(), [...requiredCoverage].sort());
    for (const [scenario, coveredIds] of Object.entries(fixtures.coverage)) {
      assert.ok(coveredIds.length > 0, `${scenario} should map to a listing`);
      for (const id of coveredIds) assert.ok(ids.has(id), `${scenario} references ${id}`);
    }
  });

  it('uses invented address data and RentCast shaped listing fields', () => {
    const allListings = [...fixtures.sale, ...fixtures.rental];
    assert.ok(fixtures.sale.length > 0 && fixtures.rental.length > 0);
    assert.ok(allListings.every((listing) => listing.zipCode === '00000'));
    assert.ok(
      allListings.every((listing) =>
        /fictional|imaginary|invented|synthetic|make believe/i.test(listing.addressLine1),
      ),
    );
    assert.ok(
      allListings.every((listing) =>
        ['Miami-Dade', 'Broward', 'Palm Beach'].includes(listing.county),
      ),
    );
    assert.ok(
      allListings.every(
        (listing) =>
          listing.id.startsWith('md-') ||
          listing.id.startsWith('br-') ||
          listing.id.startsWith('pb-'),
      ),
    );
    assert.ok(allListings.every((listing) => listing.status && listing.price > 0));
  });
});
