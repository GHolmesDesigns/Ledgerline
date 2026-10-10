CREATE TABLE outside_provider_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_date TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX outside_provider_requests_date ON outside_provider_requests (request_date);
