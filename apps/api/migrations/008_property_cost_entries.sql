ALTER TABLE properties ADD COLUMN flood_zone TEXT;

CREATE TABLE property_cost_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount REAL,
  state TEXT NOT NULL CHECK (state IN ('Quote', 'Doc', 'N/A')),
  source TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  assessment_status TEXT,
  payment_type TEXT,
  amount_unknown INTEGER NOT NULL DEFAULT 0 CHECK (amount_unknown IN (0, 1)),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX property_cost_entries_property ON property_cost_entries(property_id);
