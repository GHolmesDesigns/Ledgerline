-- Track objects created by a review decision so Undo can restore the prior state.
ALTER TABLE match_review_queue ADD COLUMN created_listing_id TEXT;
ALTER TABLE match_review_queue ADD COLUMN created_property_id TEXT;
