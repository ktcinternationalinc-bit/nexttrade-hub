-- ============================================================
-- s34_calendar_columns_consolidated.sql
-- v55.30 — Make sure calendar_events has every column the UI uses
-- Date: 2026-04-28
--
-- Background: the calendar save was failing with
--   "Could not find the 'all_day' column of 'calendar_events'
--    in the schema cache"
-- because the s26 migration that adds all_day, location, and
-- join_link was never run.
--
-- Rather than guess which earlier migrations were applied, this
-- file re-applies EVERY column add from s24, s25, and s26 in one
-- paste. Each ADD uses IF NOT EXISTS so previously-applied
-- columns are skipped silently — there's no harm in running this
-- on a database that already has them.
--
-- After this runs, the calendar should save without errors.
-- ============================================================

-- ---- From s24 (cancel + attendees) ----
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS attendees UUID[] DEFAULT '{}';

-- ---- From s25 (attendee decline) ----
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS declined_by UUID[] DEFAULT '{}';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS decline_reasons JSONB DEFAULT '{}'::jsonb;

-- ---- From s26 (location, join link, all-day) — THE MISSING ONE ----
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS join_link TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT FALSE;

-- ---- Sanity ----
COMMENT ON COLUMN calendar_events.status IS 'Lifecycle: scheduled / cancelled (v55)';
COMMENT ON COLUMN calendar_events.attendees IS 'All invited user IDs, including the primary owner (v55)';
COMMENT ON COLUMN calendar_events.declined_by IS 'User IDs who declined this event (v55)';
COMMENT ON COLUMN calendar_events.location IS 'Free-text physical or virtual location';
COMMENT ON COLUMN calendar_events.join_link IS 'URL for video/audio meeting join';
COMMENT ON COLUMN calendar_events.all_day IS 'TRUE = no clock time; UI shows "All day"';

-- ---- Refresh PostgREST schema cache ----
-- Without this, supabase-js will still complain about "schema cache" even
-- after the columns are added. NOTIFY pgrst tells the API server to reload
-- its column inventory. (Supabase usually auto-reloads on DDL, but this
-- guarantees it.)
NOTIFY pgrst, 'reload schema';

-- ---- Verification (read-only — uncomment to inspect) ----
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'calendar_events'
--    AND column_name IN ('all_day','location','join_link','status','cancelled_at','cancelled_by','cancellation_reason','attendees','declined_by','decline_reasons')
--  ORDER BY column_name;
