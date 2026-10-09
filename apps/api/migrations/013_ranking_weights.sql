CREATE TABLE ranking_weights (
  mode TEXT PRIMARY KEY CHECK (mode IN ('sale', 'rent')),
  weights TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
