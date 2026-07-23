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
  user_id TEXT,
  token_hash TEXT NOT NULL,
  invitation_token_hash TEXT,
  invitation_expires_at TEXT,
  invitation_consumed_at TEXT,
  mobile_token_hash TEXT,
  mobile_device_id TEXT,
  mobile_claimed_at TEXT,
  mobile_push_endpoint TEXT,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_pairs_source_id ON sync_pairs(source_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_user_id ON sync_pairs(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_user_id_pair
  ON sync_pairs(user_id, pair_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_invitation_expiry
  ON sync_pairs(invitation_expires_at)
  WHERE invitation_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_pairs_mobile_token
  ON sync_pairs(mobile_token_hash)
  WHERE mobile_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS sync_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_users (
  user_id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL UNIQUE,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deletion_pending')),
  intended_start_date TEXT,
  intended_end_date TEXT,
  deletion_due_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feature_key)
);

CREATE TABLE IF NOT EXISTS user_devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  device_type TEXT NOT NULL CHECK (device_type IN ('browser', 'pwa', 'windows', 'unknown')),
  display_name TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);

CREATE TABLE IF NOT EXISTS account_audit_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES app_users(user_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_audit_user_created ON account_audit_events(user_id, created_at);
