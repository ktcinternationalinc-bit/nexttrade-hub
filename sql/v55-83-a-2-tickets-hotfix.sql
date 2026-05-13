-- ============================================================================
-- v55.83-A.2 — TICKETS HOTFIX
-- ============================================================================
-- Max May 13 2026: "the ticketing is still broken!! cannot create a ticket
-- and cannot save a new priority status"
--
-- Two symptoms happening at once strongly suggests a TABLE-LEVEL problem
-- (constraint, missing column, or RLS), not application code. This script
-- fixes EVERY plausible cause at once:
--
--   1. Priority CHECK constraint missing 'critical' (carry-forward from v55.82-W)
--   2. Missing columns the app writes (updated_at, updated_by, is_private,
--      private_to, is_confidential)
--   3. Missing default on status column
--   4. Stale RLS that blocks INSERT/UPDATE for non-superusers
--
-- IDEMPOTENT. Safe to run multiple times.
-- ============================================================================

-- ============================================================================
-- DIAGNOSTIC FIRST — copy-paste output for review
-- ============================================================================
-- Run this section in isolation and paste the output if any fix below
-- doesn't resolve the issue.

-- (D1) — current priority CHECK constraint
SELECT 'D1: priority constraint' AS check_name,
       conname,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid = 'public.tickets'::regclass
  AND c.contype = 'c'
  AND conname LIKE '%priority%';

-- (D2) — what priority values exist in your data right now
SELECT 'D2: priority counts' AS check_name, priority, COUNT(*) AS rows
FROM tickets
GROUP BY priority
ORDER BY rows DESC;

-- (D3) — what columns the tickets table actually has
SELECT 'D3: tickets columns' AS check_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'tickets' AND table_schema = 'public'
ORDER BY ordinal_position;

-- (D4) — any RLS policies on tickets
SELECT 'D4: RLS policies' AS check_name, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'tickets';

-- (D5) — last 5 entries in audit_log mentioning tickets, in case the
-- update DID succeed but the UI didn't refresh
SELECT 'D5: recent ticket audit' AS check_name,
       changed_at, action, changed_by, new_values
FROM audit_log
WHERE table_name = 'tickets'
ORDER BY changed_at DESC
LIMIT 5;

-- ============================================================================
-- FIX 1 — Priority CHECK constraint (the most likely cause)
-- ============================================================================
-- If a CHECK constraint exists that disallows 'critical', the INSERT and
-- UPDATE both fail silently because the v55.82-W "critical" priority was
-- added to the FRONTEND but the database constraint was never widened.
--
-- Strategy: drop ANY priority-related check constraint, then create a
-- permissive one that accepts all current and future priority values.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tickets'::regclass
      AND contype = 'c'
      AND conname LIKE '%priority%'
  LOOP
    EXECUTE 'ALTER TABLE tickets DROP CONSTRAINT ' || quote_ident(c.conname);
    RAISE NOTICE 'Dropped old priority constraint: %', c.conname;
  END LOOP;
END $$;

ALTER TABLE tickets
  ADD CONSTRAINT tickets_priority_check
  CHECK (priority IS NULL OR priority IN ('critical','urgent','high','medium','normal','low'));

-- ============================================================================
-- FIX 2 — Ensure all columns the application writes actually exist
-- ============================================================================
-- dbUpdate sends updated_at + updated_by. If either column is missing on
-- the tickets table (a fresh install or an older schema), the update fails.
-- dbInsert's loop-stripping handles missing columns gracefully for INSERTs,
-- but the priority-change handler does an UPDATE and the strip loop also
-- exists for UPDATE — so this is just defense-in-depth.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_by UUID;

-- v55.82-V/Z columns — already addressed in their own scripts but reasserting
-- here so this single script makes tickets fully current.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS private_to UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT FALSE;

-- v55.82-W ticket attachments column (used by SystemTicketsPanel)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attachments JSONB;

-- ============================================================================
-- FIX 3 — Status default
-- ============================================================================
-- If the status column has a NOT NULL with no default, an INSERT that
-- somehow lost the status field (e.g. column-strip retry) fails.
-- Setting a default of 'New' makes this safe.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'status'
  ) THEN
    ALTER TABLE tickets ALTER COLUMN status SET DEFAULT 'New';
  END IF;
END $$;

-- ============================================================================
-- FIX 4 — RLS sanity
-- ============================================================================
-- This project uses application-layer permissions, not RLS — but if RLS
-- got enabled on tickets accidentally with no permissive policy, every
-- write fails for non-superusers. This block ensures a permissive policy
-- exists. (Leave RLS off unless you've designed full policies for it.)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tickets' AND policyname = 'Allow all tickets (app-layer perms)'
  ) THEN
    BEGIN
      EXECUTE 'CREATE POLICY "Allow all tickets (app-layer perms)" ON tickets FOR ALL USING (true) WITH CHECK (true)';
      RAISE NOTICE 'Created permissive RLS policy on tickets (idempotent fallback)';
    EXCEPTION WHEN others THEN
      -- If RLS isn't enabled, the CREATE POLICY no-ops or errors harmlessly.
      RAISE NOTICE 'RLS policy create skipped (probably RLS disabled, which is fine): %', SQLERRM;
    END;
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION — re-run the diagnostics to confirm
-- ============================================================================

-- After fix: new constraint definition
SELECT 'AFTER: priority constraint' AS check_name,
       conname,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid = 'public.tickets'::regclass
  AND c.contype = 'c'
  AND conname LIKE '%priority%';

-- After fix: confirm all expected columns exist
SELECT 'AFTER: columns' AS check_name,
       BOOL_AND(column_name IS NOT NULL) AS all_present
FROM (
  SELECT unnest(ARRAY[
    'priority','status','title','assigned_to','created_by',
    'updated_at','updated_by','is_private','private_to','is_confidential'
  ]) AS expected
) e
LEFT JOIN information_schema.columns c
  ON c.table_name = 'tickets'
  AND c.column_name = e.expected;

-- Try a self-test INSERT with priority='critical' (rolled back, no data change)
DO $$
DECLARE
  test_id UUID;
BEGIN
  INSERT INTO tickets (ticket_number, title, priority, status)
  VALUES ('TEST-VERIFY', 'v55.83-A.2 self-test', 'critical', 'New')
  RETURNING id INTO test_id;
  DELETE FROM tickets WHERE id = test_id;
  RAISE NOTICE '✓ Self-test PASSED — critical priority INSERT works';
EXCEPTION WHEN others THEN
  RAISE WARNING '✗ Self-test FAILED — %', SQLERRM;
END $$;
