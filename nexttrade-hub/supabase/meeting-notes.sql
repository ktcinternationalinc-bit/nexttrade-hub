-- ============================================================
-- MEETING NOTES — adds a dedicated meeting_notes column to
-- calendar_events. Safe to re-run.
--
-- Why a new column: the existing `notes` field is used for
-- "notes set at creation time" (description). meeting_notes
-- is separate so UI and AI can distinguish the two and so
-- ongoing meeting notes can be appended with timestamps.
-- ============================================================

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes_updated_at TIMESTAMPTZ;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Trigger to keep meeting_notes_updated_at fresh whenever meeting_notes is modified
CREATE OR REPLACE FUNCTION _bump_meeting_notes_updated()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.meeting_notes IS DISTINCT FROM OLD.meeting_notes THEN
    NEW.meeting_notes_updated_at := NOW();
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_events_notes ON calendar_events;
CREATE TRIGGER trg_calendar_events_notes
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION _bump_meeting_notes_updated();

-- Verify
SELECT 'meeting_notes column ready' AS what,
       COUNT(*) AS total_events,
       COUNT(*) FILTER (WHERE meeting_notes IS NOT NULL AND meeting_notes <> '') AS events_with_notes
FROM calendar_events;
