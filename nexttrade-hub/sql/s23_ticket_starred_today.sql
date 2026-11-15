-- ============================================================
-- v52 / s23 — Ticket "Today's Focus" star
-- ============================================================
-- Adds two columns to tickets so users can star items as
-- "I'm working on this today" without affecting priority rank.
--
-- Nadia reads `starred_today` at 5pm Eastern and nudges about any
-- starred-but-unclosed tickets. Manual-remove only per Max's spec —
-- no midnight auto-clear.
-- ============================================================

-- Backup first (idempotent)
DO $$ BEGIN
  CREATE TABLE tickets_backup_s23_20260424 AS SELECT * FROM tickets;
EXCEPTION WHEN duplicate_table THEN
  RAISE NOTICE 'tickets_backup_s23_20260424 already exists, skipping';
END $$;

-- Add the star columns
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS starred_today BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS starred_at TIMESTAMPTZ;

-- Index for the 5pm end-of-day check: "any starred tickets that aren't closed?"
CREATE INDEX IF NOT EXISTS idx_tickets_starred_today
  ON tickets (starred_today)
  WHERE starred_today = TRUE;

COMMENT ON COLUMN tickets.starred_today IS 'User marked this as "working on it today". Manual remove only; Nadia nudges at 5pm ET if not closed.';
COMMENT ON COLUMN tickets.starred_at IS 'When the star was set. Lets Nadia know how long a ticket has been starred.';

-- Sanity check
SELECT 'tickets.starred_today ready' AS status,
       (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'starred_today') AS col_exists;
