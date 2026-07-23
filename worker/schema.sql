CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  reminders TEXT NOT NULL DEFAULT '[]',
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_pairs (
  pair_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  mobile_device_id TEXT,
  mobile_push_endpoint TEXT,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_pairs_source_id ON sync_pairs(source_id);

CREATE TABLE IF NOT EXISTS sync_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);
