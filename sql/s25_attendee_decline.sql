-- ============================================================
-- v54.3 / s25 — Attendee decline tracking
-- ============================================================
-- Allows invitees to decline a meeting invitation while keeping
-- the event alive for other attendees and the creator.
--
-- declined_by: array of user UUIDs who declined this meeting.
--              An attendee appears in BOTH attendees AND declined_by
--              until the event is removed or they accept again.
--
-- When rendering the calendar:
--   - Creator sees the event normally, with a "Omar declined" indicator
--   - Decliners see it greyed out as "Declined" on their own calendar
--   - Other attendees see it normally
--
-- SAFE TO RE-RUN: IF NOT EXISTS + duplicate_table guards.
-- ============================================================

-- Backup (idempotent — if s24 backup already exists, skip)
DO $$ BEGIN
  CREATE TABLE calendar_events_backup_s25_20260424 AS SELECT * FROM calendar_events;
EXCEPTION WHEN duplicate_table THEN
  RAISE NOTICE 'calendar_events_backup_s25_20260424 already exists, skipping';
END $$;

-- ============================================================
-- DECLINE TRACKING
-- ============================================================
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS declined_by UUID[] DEFAULT '{}';

-- Optional: per-decline reason map (stored as jsonb: { "uuid": "reason text" }).
-- Many declines will have no reason; jsonb lets us store only non-empty ones.
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS decline_reasons JSONB DEFAULT '{}'::jsonb;

-- ============================================================
-- INDEXES
-- ============================================================
-- GIN on declined_by so "my declined meetings" queries are fast
CREATE INDEX IF NOT EXISTS idx_events_declined_by ON calendar_events USING GIN (declined_by);

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON COLUMN calendar_events.declined_by IS 'Array of user UUIDs who declined this invitation. They stay in attendees but appear greyed out on their own calendar.';
COMMENT ON COLUMN calendar_events.decline_reasons IS 'JSONB map { user_uuid: "reason text" } — populated only when the decliner provides a reason';

-- ============================================================
-- SANITY CHECK
-- ============================================================
SELECT
  'v54.3 decline-tracking migration applied' AS status,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='calendar_events' AND column_name='declined_by') AS declined_by_col,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='calendar_events' AND column_name='decline_reasons') AS decline_reasons_col;
