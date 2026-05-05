-- ============================================================
-- s33_tickets_status_constraint_fix.sql
-- ============================================================
-- v55.27 — Fix mismatch between UI status options and DB CHECK constraint.
--
-- The UI offers these statuses for tickets:
--   New, Acknowledged, In Progress, Blocked, On Hold, Review, Closed, Reopened
--
-- But the original schema.sql constraint only allowed:
--   New, Acknowledged, In Progress, Waiting, Review, Testing, Ready, Closed, Reopened
--
-- Result: clicking "Blocked" or "On Hold" in the UI fired an UPDATE that
-- Postgres rejected with a CHECK violation, the error was caught and toasted,
-- but the row never actually changed status. Looked like the buttons did
-- nothing.
--
-- This migration:
--   1. Drops the existing CHECK constraint on tickets.status (regardless of
--      its auto-generated name — different installs may have different names).
--   2. Adds a new constraint that includes BOTH the UI statuses AND the
--      legacy ones, so any historical data with Waiting / Testing / Ready
--      stays valid.
--
-- Idempotent: safe to run multiple times. Re-running just re-drops and
-- re-adds the same constraint.
-- ============================================================

-- Step 1: drop any existing CHECK constraint on tickets.status.
-- We loop through pg_constraint to find it by definition rather than name,
-- because the constraint name varies between installs.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'tickets'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%IN%'
  LOOP
    EXECUTE 'ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- Step 2: add the new constraint with the full set of allowed statuses.
-- Includes UI values (Blocked, On Hold) AND legacy values (Waiting, Testing, Ready)
-- so this migration is backward-safe.
ALTER TABLE tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN (
    'New',
    'Acknowledged',
    'In Progress',
    'Blocked',
    'On Hold',
    'Waiting',
    'Review',
    'Testing',
    'Ready',
    'Closed',
    'Reopened'
  ));

-- Verification query (read-only) — uncomment to inspect after running:
-- SELECT con.conname, pg_get_constraintdef(con.oid)
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- WHERE rel.relname = 'tickets' AND con.contype = 'c';
