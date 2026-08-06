-- Replace the GLOBAL UNIQUE(source_id) constraint with a tenant-scoped
-- UNIQUE(user_id, source_id). source_id is a client-supplied value, so a global
-- uniqueness constraint let any client squat / deny another tenant's source_id.
--
-- SQLite cannot drop a column-level UNIQUE in place: it is backed by an implicit
-- sqlite_autoindex_* that DROP INDEX cannot target. The only safe, portable way
-- to change the constraint is to rebuild the table and copy the data. No foreign
-- keys reference sync_pairs, so the drop/rename is safe.

CREATE TABLE sync_pairs_rebuild (
  pair_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
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

INSERT INTO sync_pairs_rebuild (
  pair_id, source_id, user_id, token_hash, invitation_token_hash,
  invitation_expires_at, invitation_consumed_at, mobile_token_hash,
  mobile_device_id, mobile_claimed_at, mobile_push_endpoint,
  ciphertext, iv, revision, updated_by, created_at, updated_at
)
SELECT
  pair_id, source_id, user_id, token_hash, invitation_token_hash,
  invitation_expires_at, invitation_consumed_at, mobile_token_hash,
  mobile_device_id, mobile_claimed_at, mobile_push_endpoint,
  ciphertext, iv, revision, updated_by, created_at, updated_at
FROM sync_pairs;

DROP TABLE sync_pairs;

ALTER TABLE sync_pairs_rebuild RENAME TO sync_pairs;

CREATE INDEX IF NOT EXISTS idx_sync_pairs_source_id ON sync_pairs(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_pairs_user_source ON sync_pairs(user_id, source_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_user_id ON sync_pairs(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_user_id_pair
  ON sync_pairs(user_id, pair_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_invitation_expiry
  ON sync_pairs(invitation_expires_at)
  WHERE invitation_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_pairs_mobile_token
  ON sync_pairs(mobile_token_hash)
  WHERE mobile_token_hash IS NOT NULL;

-- L6: back the periodic sync_rate_limits cleanup (DELETE ... WHERE window_start < ?).
CREATE INDEX IF NOT EXISTS idx_sync_rate_limits_window ON sync_rate_limits(window_start);
