import initSqlJs from 'sql.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from './app.js';
import { seedAssumptions } from './assumptions.js';
import { closeDatabase, openDatabase } from './database.js';
import { createStore } from './store.js';

describe('assumptions API', () => {
  it('seeds sample county values, leaves Palm Beach unset, and saves personal and local edits', async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    database.run(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE properties (id TEXT PRIMARY KEY, street TEXT, unit TEXT, city TEXT, zip TEXT, county TEXT, latitude REAL, longitude REAL, property_type TEXT, beds REAL, baths_total REAL, baths_full INTEGER, baths_half INTEGER, living_area_sqft INTEGER, lot_size_sqft INTEGER, year_built INTEGER, parcel_id TEXT, sample INTEGER, created_at TEXT, updated_at TEXT);
      CREATE UNIQUE INDEX properties_normalized_address ON properties (street, COALESCE(unit, ''), city, zip);
      CREATE TABLE listings (id TEXT PRIMARY KEY, property_id TEXT REFERENCES properties(id), provider TEXT, provider_id TEXT, mls_name TEXT, mls_number TEXT, mode TEXT, price INTEGER, price_period TEXT, status TEXT, hoa_fee INTEGER, image_urls TEXT, source_url TEXT, agent_name TEXT, agent_phone TEXT, agent_email TEXT, office_name TEXT, office_phone TEXT, office_email TEXT, provider_listed_date TEXT, provider_removed_date TEXT, provider_last_seen_date TEXT, first_fetched_at TEXT, last_fetched_at TEXT, field_quality TEXT, provider_history TEXT, sample INTEGER);
      CREATE TABLE listing_snapshots (id INTEGER PRIMARY KEY, listing_id TEXT, fetched_at TEXT, price INTEGER, status TEXT);
      CREATE TABLE listing_raw_payloads (id INTEGER PRIMARY KEY, listing_id TEXT, fetched_at TEXT, payload TEXT);
      CREATE TABLE property_notes (id INTEGER PRIMARY KEY, property_id TEXT, body TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE property_favorites (property_id TEXT PRIMARY KEY, created_at TEXT);
      CREATE TABLE property_dismissals (property_id TEXT PRIMARY KEY, dismissed_at TEXT);
      CREATE TABLE saved_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, mode TEXT, location TEXT, filters TEXT, price_min INTEGER, price_max INTEGER, paired_search_id INTEGER, refresh_interval_days INTEGER, last_successful_refresh_at TEXT, last_refresh_attempt_at TEXT, last_refresh_error TEXT, created_at TEXT, updated_at TEXT, location_mode TEXT DEFAULT 'city', zip TEXT, center_address TEXT, center_latitude REAL, center_longitude REAL, radius_mi REAL);
      CREATE TABLE match_review_queue (id INTEGER PRIMARY KEY, incoming_listing TEXT, candidate_property_id TEXT, reason TEXT, decision TEXT, decided_at TEXT, created_at TEXT, created_listing_id TEXT, created_property_id TEXT);
      CREATE TABLE provider_request_logs (id INTEGER PRIMARY KEY, provider TEXT, saved_search_id INTEGER, property_id TEXT, requested_at TEXT, purpose TEXT, page INTEGER, status TEXT, result_count INTEGER, error_message TEXT);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
      CREATE TABLE personal_assumptions (saved_search_id INTEGER PRIMARY KEY, down_payment_pct REAL, mortgage_rate_pct REAL, term_years INTEGER, maintenance_pct_per_year REAL, updated_at TEXT);
      CREATE TABLE local_assumptions (county TEXT PRIMARY KEY, is_set INTEGER, millage REAL, typical_non_ad_valorem_per_year REAL, homeowners_default_monthly REAL, ho6_default_monthly REAL, flood_default_monthly TEXT, source TEXT, set_on TEXT, sample INTEGER, price_per_sqft_min REAL, price_per_sqft_max REAL);`);
    const store = createStore(database);
    const server = createApp(database, store);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const root = `http://127.0.0.1:${address.port}`;
    try {
      const createdResponse = await fetch(`${root}/api/saved-searches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Broward Buy', mode: 'sale', location: 'Broward' }),
      });
      const { item } = (await createdResponse.json()) as { item: { id: number } };
      const defaults = store.getPersonalAssumptions(item.id);
      assert.equal(defaults?.downPaymentPct, 20);
      const edit = await fetch(`${root}/api/saved-searches/${item.id}/assumptions`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          downPaymentPct: 25,
          mortgageRatePct: 6.25,
          termYears: 20,
          maintenancePctPerYear: 1.2,
        }),
      });
      assert.equal(edit.status, 200);
      assert.equal(store.getPersonalAssumptions(item.id)?.termYears, 20);

      const response = await fetch(`${root}/api/assumptions`);
      const data = (await response.json()) as {
        local: Array<{
          county: string;
          set: boolean;
          millage: number | null;
          sample: boolean;
          pricePerSqftMin: number | null;
        }>;
      };
      const broward = data.local.find((entry) => entry.county === 'Broward')!;
      const palmBeach = data.local.find((entry) => entry.county === 'Palm Beach')!;
      assert.equal(broward.sample, true);
      assert.equal(broward.millage, 19.5);
      assert.equal(data.local.find((entry) => entry.county === 'Miami-Dade')?.pricePerSqftMin, 250);
      assert.equal(palmBeach.set, false);
      assert.equal(palmBeach.millage, null);

      const localEdit = await fetch(`${root}/api/local-assumptions/Broward`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          millage: 18.75,
          typicalNonAdValoremPerYear: 700,
          homeownersDefaultMonthly: 520,
          ho6DefaultMonthly: 110,
          floodDefaultMonthly: { X: 50, AE: 180, VE: 420 },
          pricePerSqftMin: 400,
          pricePerSqftMax: 800,
          source: 'Broward tax collector',
          setOn: '2026-10-09',
        }),
      });
      assert.equal(localEdit.status, 200);
      const updated = store.listLocalAssumptions().find((entry) => entry.county === 'Broward')!;
      assert.equal(updated.millage, 18.75);
      assert.equal(updated.source, 'Broward tax collector');
      assert.equal(updated.setOn, '2026-10-09');
      assert.equal(updated.sample, false);
      assert.equal(updated.pricePerSqftMax, 800);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      database.close();
    }
  });

  it('moves an unedited sample price-per-sq-ft range to the current sample range', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerline-assumptions-'));
    const database = await openDatabase(join(directory, 'ledgerline.sqlite'));
    try {
      const store = createStore(database);
      seedAssumptions(store);
      const county = (name: string) =>
        store.listLocalAssumptions().find((item) => item.county === name)!;
      // An earlier sample range, and a range the user set (edits clear the sample tag).
      store.setLocalAssumption({
        ...county('Miami-Dade'),
        pricePerSqftMin: 450,
        pricePerSqftMax: 650,
      });
      store.setLocalAssumption({
        ...county('Broward'),
        sample: false,
        pricePerSqftMin: 300,
        pricePerSqftMax: 500,
      });
      seedAssumptions(store);
      assert.deepEqual(
        [county('Miami-Dade').pricePerSqftMin, county('Miami-Dade').pricePerSqftMax],
        [250, 750],
      );
      assert.deepEqual(
        [county('Broward').pricePerSqftMin, county('Broward').pricePerSqftMax],
        [300, 500],
      );
    } finally {
      closeDatabase(database);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
