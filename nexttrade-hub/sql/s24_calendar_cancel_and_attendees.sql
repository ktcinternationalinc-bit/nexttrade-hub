-- ============================================================
-- v54.1 / s24 — Calendar cancellation + multi-attendee support
-- ============================================================
-- Adds two things:
--
-- 1. Meeting cancellation (soft-delete with audit trail)
--    - status: 'scheduled' / 'cancelled' / 'completed'
--    - cancelled_at / cancelled_by / cancellation_reason
--
-- 2. Multi-attendee meetings
--    - A new attendees UUID[] column stores ALL invited users (including
--      the creator/owner). The existing assigned_to stays as the "owner"
--      of the meeting (who created it / whose calendar primarily shows it).
--    - CalendarTab queries by `attendees @> ARRAY[currentUserId]` so
--      everyone invited sees the event on their calendar.
--    - One event = one row, shown to N people. Cancelling cancels for all.
--
-- SAFE TO RE-RUN: idempotent with IF NOT EXISTS + duplicate_table guards.
-- ============================================================

-- Backup
DO $$ BEGIN
  CREATE TABLE calendar_events_backup_s24_20260424 AS SELECT * FROM calendar_events;
EXCEPTION WHEN duplicate_table THEN
  RAISE NOTICE 'calendar_events_backup_s24_20260424 already exists, skipping';
END $$;

-- ============================================================
-- CANCELLATION FIELDS
-- ============================================================
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'cancelled', 'completed'));

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Backfill legacy rows: if completed=true, mark completed; else scheduled.
UPDATE calendar_events
  SET status = CASE WHEN completed = true THEN 'completed' ELSE 'scheduled' END
  WHERE status IS NULL;

-- ============================================================
-- MULTI-ATTENDEE SUPPORT
-- ============================================================
-- attendees is an array of user UUIDs. Backfill existing rows with
-- [assigned_to] so every event has at least one attendee (itself).
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS attendees UUID[] DEFAULT '{}';

-- Backfill: every existing event includes its assigned_to in attendees
UPDATE calendar_events
  SET attendees = ARRAY[assigned_to]
  WHERE assigned_to IS NOT NULL
    AND (attendees IS NULL OR array_length(attendees, 1) IS NULL);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_events_status ON calendar_events(status);
-- GIN index on attendees array so `attendees @> ARRAY[uid]` queries
-- (used by CalendarTab to find "all meetings I'm invited to") are fast.
CREATE INDEX IF NOT EXISTS idx_events_attendees ON calendar_events USING GIN (attendees);
-- Composite for conflict-detection lookups
CREATE INDEX IF NOT EXISTS idx_events_conflict_lookup
  ON calendar_events(assigned_to, event_date, event_time)
  WHERE status = 'scheduled';

-- ============================================================
-- COMMENTS (self-documenting schema)
-- ============================================================
COMMENT ON COLUMN calendar_events.status IS 'scheduled (default), cancelled (soft), completed';
COMMENT ON COLUMN calendar_events.cancelled_at IS 'Timestamp when cancelled; NULL if still scheduled';
COMMENT ON COLUMN calendar_events.cancelled_by IS 'User who cancelled the event';
COMMENT ON COLUMN calendar_events.cancellation_reason IS 'Optional reason shown on the cancelled event';
COMMENT ON COLUMN calendar_events.attendees IS 'Array of user UUIDs invited to this meeting. One event = one row, shown on every attendee calendar.';

-- ============================================================
-- SANITY CHECK
-- ============================================================
SELECT
  'v54.1 calendar migration applied' AS status,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='calendar_events' AND column_name='status') AS status_col,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='calendar_events' AND column_name='attendees') AS attendees_col,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='calendar_events' AND column_name='cancelled_at') AS cancelled_col,
  (SELECT COUNT(*) FROM calendar_events) AS total_events,
  (SELECT COUNT(*) FROM calendar_events WHERE status = 'scheduled') AS scheduled_events,
  (SELECT COUNT(*) FROM calendar_events WHERE array_length(attendees, 1) > 0) AS events_with_attendees;
