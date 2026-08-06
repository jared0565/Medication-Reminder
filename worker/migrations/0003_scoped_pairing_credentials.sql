ALTER TABLE sync_pairs ADD COLUMN invitation_token_hash TEXT;
ALTER TABLE sync_pairs ADD COLUMN invitation_expires_at TEXT;
ALTER TABLE sync_pairs ADD COLUMN invitation_consumed_at TEXT;
ALTER TABLE sync_pairs ADD COLUMN mobile_token_hash TEXT;
ALTER TABLE sync_pairs ADD COLUMN mobile_claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_sync_pairs_user_id_pair
  ON sync_pairs(user_id, pair_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_invitation_expiry
  ON sync_pairs(invitation_expires_at)
  WHERE invitation_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_pairs_mobile_token
  ON sync_pairs(mobile_token_hash)
  WHERE mobile_token_hash IS NOT NULL;
