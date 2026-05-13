-- v55.82-Z — Confidential tickets (Max May 12 2026)
--
-- Adds a second-tier privacy column to tickets:
--   is_confidential — boolean, default FALSE. When TRUE, the ticket is
--                     visible only to: the creator, the assigned_to user,
--                     anyone in additional_assignees, and super_admin.
--                     Regular admins and other team members cannot see it.
--
-- This is SEPARATE from is_private (super-admin-only private tickets,
-- shipped in v55.82-V). The two flags are mutually exclusive at the UI
-- layer but the database doesn't enforce that — if both are set, the
-- stricter is_private rule wins.
--
-- Idempotent — safe to re-run.

-- Make sure the v55.82-V columns are in place first (no-op if already).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS private_to UUID;

-- New column for v55.82-Z confidential tickets.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT FALSE;

-- Optional index — only helpful if a lot of confidential tickets exist.
CREATE INDEX IF NOT EXISTS idx_tickets_is_confidential
  ON tickets (is_confidential)
  WHERE is_confidential = TRUE;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'tickets'
  AND column_name IN ('is_private', 'private_to', 'is_confidential')
ORDER BY column_name;
