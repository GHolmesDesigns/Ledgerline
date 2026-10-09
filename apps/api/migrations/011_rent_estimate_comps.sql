ALTER TABLE comparable_rent_figures RENAME TO comparable_rent_figures_old;

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
  estimate_comps TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL
);

INSERT INTO comparable_rent_figures
  (property_id, source, value, low, high, reason, comp_count, max_distance_mi, comp_ids, computed_at)
SELECT property_id, source, value, low, high, reason, comp_count, max_distance_mi, comp_ids, computed_at
FROM comparable_rent_figures_old;

DROP TABLE comparable_rent_figures_old;
