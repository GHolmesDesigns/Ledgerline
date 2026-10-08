CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE provider_request_logs ADD COLUMN property_id TEXT REFERENCES properties (id) ON DELETE SET NULL;

CREATE INDEX provider_request_logs_requested_at ON provider_request_logs (requested_at);
