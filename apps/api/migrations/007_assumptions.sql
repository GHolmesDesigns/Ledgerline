CREATE TABLE personal_assumptions (
  saved_search_id INTEGER PRIMARY KEY REFERENCES saved_searches (id) ON DELETE CASCADE,
  down_payment_pct REAL NOT NULL CHECK (down_payment_pct >= 0 AND down_payment_pct <= 100),
  mortgage_rate_pct REAL NOT NULL CHECK (mortgage_rate_pct >= 0 AND mortgage_rate_pct <= 100),
  term_years INTEGER NOT NULL CHECK (term_years > 0 AND term_years <= 100),
  maintenance_pct_per_year REAL NOT NULL CHECK (maintenance_pct_per_year >= 0 AND maintenance_pct_per_year <= 100),
  updated_at TEXT NOT NULL
);

CREATE TABLE local_assumptions (
  county TEXT PRIMARY KEY,
  is_set INTEGER NOT NULL CHECK (is_set IN (0, 1)),
  millage REAL,
  typical_non_ad_valorem_per_year REAL,
  homeowners_default_monthly REAL,
  ho6_default_monthly REAL,
  flood_default_monthly TEXT NOT NULL DEFAULT '{}',
  source TEXT,
  set_on TEXT,
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  CHECK (is_set = 0 OR (millage IS NOT NULL AND source IS NOT NULL AND set_on IS NOT NULL))
);
