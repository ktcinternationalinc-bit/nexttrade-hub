-- ============================================================
-- s26_calendar_data_fields.sql
-- v55 Stage 1 — Calendar enrichment (data fields)
-- Date: 2026-04-25
--
-- Adds three optional fields to calendar events so the team can
-- record WHERE a meeting is, the JOIN LINK for it, and whether
-- it's an ALL-DAY event with no specific clock time.
--
-- What this gives the user:
--   • Location:  free-text, e.g. "KTC office", "Cairo Marriott"
--   • Join link: any URL — Zoom, Meet, Teams, etc.
--   • All-day:   checkbox on the form. When on, the event has
--                no clock time and shows as "All day" everywhere.
--
-- Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS).
-- Backup table created up front per the project's safety rule.
-- ============================================================

-- 1. Pre-migration backup. Lets us restore in seconds if anything
--    is wrong post-deploy. Drop this table after a few stable days.
CREATE TABLE IF NOT EXISTS calendar_events_backup_s26_20260425 AS
  SELECT * FROM calendar_events;

-- 2. Add the three new optional fields. All nullable / defaulted so
--    every existing row stays valid and unchanged.
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location  TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS join_link TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS all_day   BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Sanity comments for future maintainers
COMMENT ON COLUMN calendar_events.location  IS 'Free-text physical or virtual location (v55 Stage 1)';
COMMENT ON COLUMN calendar_events.join_link IS 'URL for video/audio meeting join (v55 Stage 1)';
COMMENT ON COLUMN calendar_events.all_day   IS 'TRUE = no clock time; UI shows "All day" (v55 Stage 1)';

-- 4. Verification block — comment out once confirmed in Supabase SQL editor.
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'calendar_events'
--    AND column_name IN ('location', 'join_link', 'all_day')
--  ORDER BY column_name;
