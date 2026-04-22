-- ============================================================
-- session5-meeting-notes.sql
-- 
-- PURPOSE
--   Upgrade the meeting notes model from a single overwritable text column
--   to a dedicated `meeting_notes` table. Each event can have many notes,
--   each with its own author + timestamp. Team collaboration. Append-only
--   by convention (we still allow edit+delete of your own notes).
--
-- WHY
--   Problem 1: Previously `calendar_events.meeting_notes` was ONE column —
--     anyone editing overwrote everyone. No history. No attribution.
--   Problem 2: User wanted to keep adding notes even after the meeting
--     ended, including on a future reopen of the same meeting.
--   Problem 3: Team needs shared visibility.
--
-- SAFE TO RE-RUN
--   Idempotent — all CREATE IF NOT EXISTS, column adds guarded.
--   Existing `meeting_notes` column on calendar_events is NOT dropped.
--   We migrate existing legacy notes into the new table as seeded rows.
-- ============================================================

-- -------- meeting_notes table --------
CREATE TABLE IF NOT EXISTS meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note_text TEXT NOT NULL CHECK (char_length(note_text) <= 10000),
  -- 'note' (general), 'action_item' (checkbox item), 'decision' (important call-out)
  note_kind TEXT NOT NULL DEFAULT 'note' CHECK (note_kind IN ('note', 'action_item', 'decision')),
  -- For action_items: tracks completion
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_event ON meeting_notes(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_author ON meeting_notes(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_open_actions
  ON meeting_notes(event_id) WHERE note_kind = 'action_item' AND is_completed = false;

ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "auth_read_mn" ON meeting_notes FOR SELECT USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "auth_write_mn" ON meeting_notes FOR ALL USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------- Seed from existing legacy notes --------
-- For each calendar_events row that has a non-empty meeting_notes text,
-- insert ONE seed row into meeting_notes attributed to the checker-in.
-- Guarded: only runs if no meeting_note already exists for that event
-- (so re-running the migration doesn't double-seed).
INSERT INTO meeting_notes (event_id, author_id, note_text, note_kind, created_at)
SELECT
  ce.id,
  ce.checked_in_by,
  ce.meeting_notes,
  'note',
  COALESCE(ce.checked_in_at, ce.updated_at, ce.created_at, NOW())
FROM calendar_events ce
WHERE ce.meeting_notes IS NOT NULL
  AND char_length(trim(ce.meeting_notes)) > 0
  AND NOT EXISTS (SELECT 1 FROM meeting_notes mn WHERE mn.event_id = ce.id);

-- -------- Add a count column for fast rendering of the 📝 indicator --------
-- This is a denormalized cache updated by triggers. Faster than COUNT(*) on render.
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS notes_count INTEGER NOT NULL DEFAULT 0;

-- Seed existing counts from actual rows
UPDATE calendar_events ce
SET notes_count = (SELECT COUNT(*) FROM meeting_notes mn WHERE mn.event_id = ce.id);

-- -------- Trigger: keep notes_count in sync --------
CREATE OR REPLACE FUNCTION sync_event_notes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE calendar_events SET notes_count = notes_count + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE calendar_events SET notes_count = GREATEST(0, notes_count - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_event_notes_count ON meeting_notes;
CREATE TRIGGER trg_sync_event_notes_count
AFTER INSERT OR DELETE ON meeting_notes
FOR EACH ROW EXECUTE FUNCTION sync_event_notes_count();

-- -------- Trigger: keep updated_at fresh on note edits --------
CREATE OR REPLACE FUNCTION touch_meeting_note_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_meeting_note ON meeting_notes;
CREATE TRIGGER trg_touch_meeting_note
BEFORE UPDATE ON meeting_notes
FOR EACH ROW EXECUTE FUNCTION touch_meeting_note_updated_at();

-- -------- Verify --------
SELECT
  (SELECT COUNT(*) FROM meeting_notes) AS notes_total,
  (SELECT COUNT(*) FROM calendar_events WHERE notes_count > 0) AS events_with_notes,
  (SELECT COUNT(*) FROM calendar_events WHERE meeting_notes IS NOT NULL AND char_length(trim(meeting_notes)) > 0) AS legacy_events_with_notes;
-- Last two should match after the initial run.
