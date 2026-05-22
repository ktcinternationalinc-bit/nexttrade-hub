-- v55.82-V — Private tickets for super_admin (Max May 12 2026)
--
-- Adds two columns to tickets so super_admin can create tickets that
-- only they (and their AI assistants operating in their session) can see.
--
-- is_private  — boolean, default FALSE. TRUE = restricted visibility.
-- private_to  — UUID of the user who can see it. Defaults to created_by
--               at insert time. Other users (regardless of admin role)
--               cannot see private tickets that aren't theirs.
--
-- Idempotent — safe to re-run.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS private_to UUID;

-- Index so the filter clause is fast for users with lots of tickets.
CREATE INDEX IF NOT EXISTS idx_tickets_private_to
  ON tickets (private_to)
  WHERE is_private = TRUE;

-- Verify
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'tickets'
  AND column_name IN ('is_private', 'private_to')
ORDER BY column_name;
