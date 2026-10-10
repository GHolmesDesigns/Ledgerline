CREATE TABLE property_photos (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  date_added TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE INDEX property_photos_property_order ON property_photos(property_id, sort_order, id);
