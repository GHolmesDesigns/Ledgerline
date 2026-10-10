CREATE TABLE custom_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE property_tags (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  date_added TEXT NOT NULL,
  PRIMARY KEY (property_id, normalized_name)
);

CREATE INDEX property_tags_normalized ON property_tags(normalized_name, property_id);
