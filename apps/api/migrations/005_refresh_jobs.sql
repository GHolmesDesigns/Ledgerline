ALTER TABLE saved_searches ADD COLUMN last_successful_refresh_at TEXT;
ALTER TABLE saved_searches ADD COLUMN last_refresh_attempt_at TEXT;
ALTER TABLE saved_searches ADD COLUMN last_refresh_error TEXT;

CREATE TABLE provider_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  saved_search_id INTEGER REFERENCES saved_searches (id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL,
  purpose TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page > 0),
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  result_count INTEGER,
  error_message TEXT
);

CREATE INDEX provider_request_logs_search ON provider_request_logs (saved_search_id, requested_at);
