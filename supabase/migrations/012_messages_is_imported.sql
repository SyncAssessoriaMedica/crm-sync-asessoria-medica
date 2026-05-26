-- Mark messages imported from historical conversations so the follow-up cron
-- does not treat them as "last manual outbound" and trigger spurious follow-ups.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_imported boolean NOT NULL DEFAULT false;

-- Allow the cron query (.eq("is_imported", false)) to use an index scan.
CREATE INDEX IF NOT EXISTS idx_messages_is_imported
  ON messages (is_imported)
  WHERE is_imported = false;
