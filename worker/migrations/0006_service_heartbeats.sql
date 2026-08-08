-- Records that a scheduled run actually completed, so "the reminders stopped"
-- becomes observable instead of being reported by a user who missed a dose.
--
-- The worker answering requests proves nothing about the cron: fetch and
-- scheduled fail independently, and it is the cron that delivers reminders.
CREATE TABLE IF NOT EXISTS service_heartbeats (
  name TEXT PRIMARY KEY,
  last_ok_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
