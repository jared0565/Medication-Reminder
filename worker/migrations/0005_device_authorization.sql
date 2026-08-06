-- Authenticated device pairing (self-hosted OAuth 2.0 Device Authorization Grant,
-- RFC 8628). Lets the owner Windows widget obtain an account-scoped, revocable
-- credential by having the signed-in browser approve a short user code, instead
-- of the retired anonymous-pairing path.

-- Short-lived pending authorization requests. The widget polls with the secret
-- device_code (stored only as a hash); the browser approves the human user_code.
CREATE TABLE IF NOT EXISTS device_authorizations (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES app_users(user_id) ON DELETE CASCADE,
  device_type TEXT NOT NULL DEFAULT 'windows' CHECK (device_type IN ('browser', 'pwa', 'windows', 'unknown')),
  device_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'claimed', 'denied')),
  expires_at TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL DEFAULT 5,
  last_polled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_auth_expiry ON device_authorizations(expires_at);

-- Long-lived, revocable credentials issued to an approved device. Stored as a
-- hash only; scoped to a single account. Distinct token prefix from sessions so
-- it can never be confused with the cookie-only session bearer.
CREATE TABLE IF NOT EXISTS device_credentials (
  credential_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  device_id TEXT,
  device_type TEXT NOT NULL DEFAULT 'windows' CHECK (device_type IN ('browser', 'pwa', 'windows', 'unknown')),
  display_name TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_credentials_user_id ON device_credentials(user_id);
