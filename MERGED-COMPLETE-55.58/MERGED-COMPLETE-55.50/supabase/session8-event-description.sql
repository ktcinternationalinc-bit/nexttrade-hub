-- ============================================================
-- session8-event-description.sql
-- Adds a pre-meeting description/agenda field to calendar events
-- Distinct from meeting_notes (which are filled DURING or AFTER the meeting)
-- ============================================================

-- BACKUP first (safe — no-op if backup already exists)
DO $$ BEGIN
  CREATE TABLE calendar_events_backup_s8_20260422 AS SELECT * FROM calendar_events;
EXCEPTION WHEN duplicate_table THEN
  RAISE NOTICE 'backup table already exists, skipping';
END $$;

-- Add the field
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Rename existing notes-columns for conceptual clarity (comments only, field names unchanged):
-- description     = PRE-meeting agenda / purpose (filled when the event is created)
-- meeting_notes   = meeting minutes (filled DURING or AFTER via the postNewNote flow)

COMMENT ON COLUMN calendar_events.description IS 'Pre-meeting agenda/description entered when creating the event. Distinct from meeting_notes which captures notes during/after.';

-- Sanity check
SELECT 'calendar_events.description column exists' AS what
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'calendar_events' AND column_name = 'description'
);
