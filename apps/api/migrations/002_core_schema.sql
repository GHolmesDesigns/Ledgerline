-- Core records (C5): properties, listings, snapshots, raw payloads, personal data,
-- saved searches, and the match review queue.
--
-- Property IDs start with 'prop_' and listing IDs with 'lst_', so the two can never
-- collide. Notes, favorites, and dismissals reference properties only, which keeps
-- them intact when a property's listings are replaced.
-- Column names follow the normalized model, never a provider's field names.

CREATE TABLE properties (
  id TEXT PRIMARY KEY CHECK (id LIKE 'prop\_%' ESCAPE '\'),
  street TEXT NOT NULL,
  unit TEXT,
  city TEXT NOT NULL,
  zip TEXT NOT NULL,
  county TEXT,
  latitude REAL,
  longitude REAL,
  property_type TEXT,
  beds REAL,
  baths_total REAL,
  baths_full INTEGER,
  baths_half INTEGER,
  living_area_sqft INTEGER,
  lot_size_sqft INTEGER,
  year_built INTEGER,
  parcel_id TEXT,
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- An exact match on normalized address and unit is the same property.
CREATE UNIQUE INDEX properties_normalized_address
  ON properties (street, COALESCE(unit, ''), city, zip);
CREATE INDEX properties_county ON properties (county);

CREATE TABLE listings (
  id TEXT PRIMARY KEY CHECK (id LIKE 'lst\_%' ESCAPE '\'),
  property_id TEXT NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  mls_name TEXT,
  mls_number TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('sale', 'rent')),
  price INTEGER,
  price_period TEXT NOT NULL CHECK (price_period IN ('total', 'month', 'week', 'year')),
  status TEXT NOT NULL,
  hoa_fee INTEGER,
  image_urls TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  agent_name TEXT,
  agent_phone TEXT,
  agent_email TEXT,
  office_name TEXT,
  office_phone TEXT,
  office_email TEXT,
  provider_listed_date TEXT,
  provider_removed_date TEXT,
  provider_last_seen_date TEXT,
  first_fetched_at TEXT NOT NULL,
  last_fetched_at TEXT NOT NULL,
  field_quality TEXT NOT NULL DEFAULT '{}',
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  UNIQUE (provider, provider_id)
);

CREATE INDEX listings_property ON listings (property_id);

CREATE TABLE listing_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  price INTEGER,
  status TEXT NOT NULL
);

CREATE INDEX listing_snapshots_listing ON listing_snapshots (listing_id, fetched_at);

-- Provider responses kept for debugging. The web client never reads this table.
CREATE TABLE listing_raw_payloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX listing_raw_payloads_listing ON listing_raw_payloads (listing_id, fetched_at);

CREATE TABLE property_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX property_notes_property ON property_notes (property_id);

CREATE TABLE property_favorites (
  property_id TEXT PRIMARY KEY REFERENCES properties (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE property_dismissals (
  property_id TEXT PRIMARY KEY REFERENCES properties (id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL
);

-- refresh_interval_days stays NULL until the refresh interval is decided (an open
-- decision in the plan); there is deliberately no default.
CREATE TABLE saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('sale', 'rent')),
  location TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  price_min INTEGER,
  price_max INTEGER,
  paired_search_id INTEGER REFERENCES saved_searches (id) ON DELETE SET NULL,
  refresh_interval_days INTEGER CHECK (refresh_interval_days IS NULL OR refresh_interval_days > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (paired_search_id IS NULL OR paired_search_id <> id),
  CHECK (price_min IS NULL OR price_max IS NULL OR price_min <= price_max)
);

-- An ambiguous incoming listing waits here instead of being merged or duplicated.
-- incoming_listing holds the normalized incoming record as JSON, so nothing is
-- created until a decision is made. decision stays NULL while pending.
CREATE TABLE match_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incoming_listing TEXT NOT NULL,
  candidate_property_id TEXT NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('link', 'keep_separate')),
  decided_at TEXT,
  created_at TEXT NOT NULL,
  CHECK ((decision IS NULL) = (decided_at IS NULL))
);

CREATE INDEX match_review_queue_pending ON match_review_queue (decision, candidate_property_id);
