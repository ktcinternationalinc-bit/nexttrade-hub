-- ============================================
-- NEXTTRADE HUB — FULL MIGRATION
-- Run this once against your Supabase database
-- ============================================

-- ─── 1. USER SESSIONS: logout tracking ───
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS logout_reason TEXT;
-- Values: 'manual', 'auto_timeout', NULL (page closed/unknown)

COMMENT ON COLUMN user_sessions.logout_reason IS 'manual = clocked out, auto_timeout = 30min inactivity';

CREATE INDEX IF NOT EXISTS idx_sessions_date ON user_sessions(date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_reason ON user_sessions(logout_reason);


-- ─── 2. TICKETS: attachments support ───
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
-- Each entry: { "name": "file.pdf", "url": "https://...", "size": 12345, "type": "application/pdf", "uploaded_at": "...", "uploaded_by": "uuid" }

COMMENT ON COLUMN tickets.attachments IS 'JSONB array of file attachment objects';


-- ─── 3. CALENDAR EVENTS: meeting notes ───
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes_by UUID;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes_at TIMESTAMPTZ;

COMMENT ON COLUMN calendar_events.meeting_notes IS 'Notes recorded during/after the meeting';
COMMENT ON COLUMN calendar_events.meeting_notes_by IS 'User who wrote the meeting notes';
COMMENT ON COLUMN calendar_events.meeting_notes_at IS 'When meeting notes were saved';

CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(event_date);


-- ─── 4. INVOICES: dual transaction linking (Egypt Bank + Treasury) ───
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_egypt_bank_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_treasury_id UUID;

COMMENT ON COLUMN invoices.linked_egypt_bank_id IS 'FK to egypt_bank_transactions — linked Egypt bank payment';
COMMENT ON COLUMN invoices.linked_treasury_id IS 'FK to treasury — linked treasury/cash register entry';

CREATE INDEX IF NOT EXISTS idx_invoices_egypt_link ON invoices(linked_egypt_bank_id);
CREATE INDEX IF NOT EXISTS idx_invoices_treasury_link ON invoices(linked_treasury_id);


-- ─── 5. AUDIT LOG: ensure record_id exists for ticket linking ───
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS record_id UUID;

COMMENT ON COLUMN audit_log.record_id IS 'ID of the record that was created/updated/deleted';

CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(table_name, record_id);


-- ─── 6. DAILY LOG: ensure login category works ───
-- (No schema change needed, just confirming log_category accepts 'login')
-- The app now logs clock-in/clock-out/auto-timeout events with log_category = 'login'


-- ─── VERIFY ───
-- Run these to confirm columns exist:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'logout_reason';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'attachments';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'meeting_notes';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'linked_egypt_bank_id';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_log' AND column_name = 'record_id';
