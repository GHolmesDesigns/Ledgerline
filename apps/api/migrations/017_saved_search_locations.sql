ALTER TABLE saved_searches ADD COLUMN location_mode TEXT NOT NULL DEFAULT 'city'
  CHECK (location_mode IN ('city', 'zip', 'radius'));
ALTER TABLE saved_searches ADD COLUMN zip TEXT;
ALTER TABLE saved_searches ADD COLUMN center_address TEXT;
ALTER TABLE saved_searches ADD COLUMN center_latitude REAL;
ALTER TABLE saved_searches ADD COLUMN center_longitude REAL;
ALTER TABLE saved_searches ADD COLUMN radius_mi REAL;

CREATE INDEX saved_searches_location_mode ON saved_searches (location_mode);
