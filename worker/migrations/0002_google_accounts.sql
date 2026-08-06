ALTER TABLE sync_pairs ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sync_pairs_user_id ON sync_pairs(user_id);

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
