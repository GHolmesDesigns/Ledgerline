ALTER TABLE local_assumptions ADD COLUMN price_per_sqft_min REAL;
ALTER TABLE local_assumptions ADD COLUMN price_per_sqft_max REAL;
ALTER TABLE properties ADD COLUMN value_overrides TEXT NOT NULL DEFAULT '{}';
ALTER TABLE listings ADD COLUMN implausible_flags TEXT NOT NULL DEFAULT '[]';
