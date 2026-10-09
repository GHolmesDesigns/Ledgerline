CREATE TABLE comparable_rent_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  same_type INTEGER NOT NULL CHECK (same_type IN (0, 1)),
  same_beds INTEGER NOT NULL CHECK (same_beds IN (0, 1)),
  living_area_tolerance_pct REAL NOT NULL CHECK (living_area_tolerance_pct BETWEEN 0 AND 100),
  radius_mi REAL NOT NULL CHECK (radius_mi > 0 AND radius_mi <= 100),
  seen_within_days INTEGER NOT NULL CHECK (seen_within_days > 0 AND seen_within_days <= 365),
  min_comps INTEGER NOT NULL CHECK (min_comps >= 1 AND min_comps <= 50),
  updated_at TEXT NOT NULL
);

CREATE TABLE comparable_rent_figures (
  property_id TEXT PRIMARY KEY REFERENCES properties (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('same_home', 'local_comps', 'rent_estimate', 'unavailable')),
  value INTEGER,
  low INTEGER,
  high INTEGER,
  reason TEXT,
  comp_count INTEGER NOT NULL DEFAULT 0,
  max_distance_mi REAL,
  comp_ids TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL
);
