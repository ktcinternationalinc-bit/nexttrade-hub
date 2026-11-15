-- ============================================================
-- KTC NextTrade Hub — Session 2 SQL migration
-- Date: April 20, 2026
-- Purpose: foundation for R1 (recurring events) + reminder engine
-- Run in Supabase SQL Editor BEFORE deploying the code zip.
-- All statements are idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- STEP 1 — BACKUPS (mandatory, per Max's rule)
-- ============================================================
DROP TABLE IF EXISTS calendar_events_backup_session2_20260420;
CREATE TABLE calendar_events_backup_session2_20260420 AS SELECT * FROM calendar_events;

SELECT 'BACKUP READY' AS step,
       (SELECT COUNT(*) FROM calendar_events_backup_session2_20260420) AS calendar_rows;


-- ============================================================
-- STEP 2 — calendar_events: series + recurrence engine columns
-- ============================================================
-- series_id groups master + all occurrences together.
-- is_series_master: true on the row the user created ("template"), false on generated occurrences.
-- recurrence_interval: "every N" (N days / weeks / months). Default 1. Example: weekly+2 = biweekly.
-- original_event_date: for R2 (Session 3, postpone one occurrence) — remembers the original date
-- when an occurrence is moved. Null otherwise.
-- recurrence_horizon_until: how far ahead the generator has already materialized for this series.
-- Lets the generator be incremental without scanning.
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS series_id UUID;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurrence_interval INT DEFAULT 1;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_series_master BOOLEAN DEFAULT false;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS original_event_date DATE;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurrence_horizon_until DATE;

-- Guard the interval to a sensible range. 99 covers "every 99 days/weeks/months".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'calendar_events_interval_range'
  ) THEN
    ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_interval_range
      CHECK (recurrence_interval IS NULL OR (recurrence_interval >= 1 AND recurrence_interval <= 99));
  END IF;
END $$;

-- Unique constraint: within a series, no duplicate occurrences on the same date.
-- This is the generator's idempotency guarantee — re-running the generator never duplicates.
-- NOTE: no WHERE predicate. PG treats NULLs as distinct in unique indexes by
-- default (NULLS DISTINCT), so non-recurring events (series_id=NULL) coexist
-- freely — every (NULL, date) tuple is considered unique-to-itself. We use a
-- COMPLETE index (not partial) because PostgreSQL's INSERT ... ON CONFLICT
-- (series_id, event_date) requires a full unique index on exactly those columns;
-- partial indexes with a WHERE clause cannot be matched by supabase-js's
-- onConflict option (which doesn't pass the WHERE predicate through).
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_series_date_unique
  ON calendar_events(series_id, event_date);

-- Fast lookup for "all rows in this series" and "all series that need materializing".
CREATE INDEX IF NOT EXISTS idx_calendar_events_series_id
  ON calendar_events(series_id)
  WHERE series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_masters
  ON calendar_events(is_series_master, recurring)
  WHERE is_series_master = true AND recurring IS NOT NULL AND recurring <> 'none';


-- ============================================================
-- STEP 3 — BACKFILL existing recurring events as series masters
-- Any pre-Session-2 row with recurring != 'none' becomes a series master.
-- The generator will then materialize their future occurrences on first run.
-- Rows that already have series_id (shouldn't be any pre-deploy) are skipped.
-- ============================================================
UPDATE calendar_events
SET
  series_id = gen_random_uuid(),
  is_series_master = true,
  recurrence_interval = COALESCE(recurrence_interval, 1),
  recurrence_horizon_until = event_date  -- nothing materialized yet beyond the master row
WHERE recurring IS NOT NULL
  AND recurring <> 'none'
  AND series_id IS NULL;

SELECT 'BACKFILL COUNT' AS step, COUNT(*) AS existing_recurring_events_promoted_to_masters
FROM calendar_events
WHERE is_series_master = true;


-- ============================================================
-- STEP 4 — scheduled_reminders table
-- NOTE: there is already a `reminders` table (user-typed text to-dos in
-- PersonalDashboard) and a `team_reminders` table. We use a DIFFERENT name
-- for the system-scheduled notification queue to avoid collision.
-- ============================================================

-- Defensive: if an EARLIER version of this file was already run with partial
-- unique indexes, drop them so the CREATE UNIQUE INDEX statements below
-- produce the corrected non-partial versions. Idempotent no-op otherwise.
-- (Rationale: partial unique indexes cannot be matched by INSERT ... ON CONFLICT
-- in supabase-js; see full note on each CREATE UNIQUE INDEX below.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'idx_calendar_events_series_date_unique'
      AND indexdef ILIKE '%WHERE%series_id IS NOT NULL%'
  ) THEN
    DROP INDEX public.idx_calendar_events_series_date_unique;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'idx_scheduled_reminders_unique'
      AND indexdef ILIKE '%WHERE%sent_at IS NULL%'
  ) THEN
    DROP INDEX public.idx_scheduled_reminders_unique;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('event','ticket')),
  target_id UUID NOT NULL,

  scheduled_for TIMESTAMPTZ NOT NULL,
  remind_type TEXT NOT NULL CHECK (remind_type IN ('day_before','day_of','30min_before','custom')),

  -- Denormalized for the dispatcher so it doesn't have to re-join to tickets/events
  -- at fire time. Kept in sync by the scheduler; staleness is OK for display.
  subject_snapshot TEXT,
  body_snapshot    TEXT,

  sent_at TIMESTAMPTZ,
  send_result JSONB,     -- { sent: bool, reason: '...' } captured from notifyServer
  acknowledged_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- De-duplication: one reminder per (target, user, type, scheduled_for).
-- Including scheduled_for in the tuple (rather than using a partial predicate
-- on sent_at) means:
--   - Same scheduled_for re-scheduled = same tuple = dedup via upsert
--   - Reschedule-to-new-time = different scheduled_for = new row allowed,
--     even if a prior reminder for the same (target,user,type) already sent
-- This is a COMPLETE (non-partial) unique index so it can be matched by
-- PostgreSQL's INSERT ... ON CONFLICT inference spec, which is what
-- supabase-js's onConflict option relies on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_reminders_unique
  ON scheduled_reminders(target_kind, target_id, target_user_id, remind_type, scheduled_for);

-- Dispatcher's hot-path index: "fetch everything due to send now."
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_pending
  ON scheduled_reminders(scheduled_for)
  WHERE sent_at IS NULL;

-- For clearing when event/ticket is cancelled or rescheduled.
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_target
  ON scheduled_reminders(target_kind, target_id);

-- RLS — open read/write for authenticated (matches the rest of the app's pattern)
ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "auth_read_sr" ON scheduled_reminders FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "auth_write_sr" ON scheduled_reminders FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- STEP 5 — VERIFY (all checks should return true / nonzero)
-- ============================================================
SELECT 'calendar_events cols' AS what,
       bool_or(column_name = 'series_id')                AS has_series_id,
       bool_or(column_name = 'recurrence_interval')      AS has_interval,
       bool_or(column_name = 'is_series_master')         AS has_master_flag,
       bool_or(column_name = 'original_event_date')      AS has_original_date,
       bool_or(column_name = 'recurrence_horizon_until') AS has_horizon
FROM information_schema.columns
WHERE table_name = 'calendar_events';

SELECT 'scheduled_reminders cols' AS what,
       COUNT(*) FILTER (WHERE column_name = 'target_user_id') AS has_target_user,
       COUNT(*) FILTER (WHERE column_name = 'target_kind')    AS has_target_kind,
       COUNT(*) FILTER (WHERE column_name = 'target_id')      AS has_target_id,
       COUNT(*) FILTER (WHERE column_name = 'scheduled_for')  AS has_scheduled_for,
       COUNT(*) FILTER (WHERE column_name = 'remind_type')    AS has_remind_type,
       COUNT(*) FILTER (WHERE column_name = 'sent_at')        AS has_sent_at
FROM information_schema.columns
WHERE table_name = 'scheduled_reminders';

SELECT 'indexes' AS what,
       bool_or(indexname = 'idx_calendar_events_series_date_unique') AS has_series_uniq,
       bool_or(indexname = 'idx_scheduled_reminders_unique')         AS has_sr_uniq,
       bool_or(indexname = 'idx_scheduled_reminders_pending')        AS has_sr_pending
FROM pg_indexes
WHERE schemaname = 'public';

SELECT 'DONE ✅' AS step;


-- ============================================================
-- ROLLBACK (use only if verify fails OR deploy breaks things)
-- ============================================================
-- BEGIN;
--   TRUNCATE calendar_events;
--   INSERT INTO calendar_events SELECT * FROM calendar_events_backup_session2_20260420;
--   DROP TABLE IF EXISTS scheduled_reminders CASCADE;
--   -- New columns are harmless to leave behind, but if you want a full rollback:
--   ALTER TABLE calendar_events DROP COLUMN IF EXISTS series_id;
--   ALTER TABLE calendar_events DROP COLUMN IF EXISTS recurrence_interval;
--   ALTER TABLE calendar_events DROP COLUMN IF EXISTS is_series_master;
--   ALTER TABLE calendar_events DROP COLUMN IF EXISTS original_event_date;
--   ALTER TABLE calendar_events DROP COLUMN IF EXISTS recurrence_horizon_until;
-- COMMIT;


-- ============================================================
-- DROP BACKUP (run ~1 week after deploy is stable)
-- ============================================================
-- DROP TABLE calendar_events_backup_session2_20260420;
