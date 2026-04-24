-- Add logout_reason to user_sessions
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS logout_reason TEXT;

-- Add attachments to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- IMPORTANT: Create Supabase Storage bucket for ticket attachments
-- Go to Supabase Dashboard → Storage → New Bucket → Name: "attachments" → Public: ON
-- Or run: INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', true);

-- Add meeting notes to calendar events
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes_by UUID;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_notes_at TIMESTAMPTZ;

-- Add Egypt Bank linking to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_egypt_bank_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_treasury_id UUID;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_date ON user_sessions(date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_reason ON user_sessions(logout_reason);
CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_invoices_egypt_link ON invoices(linked_egypt_bank_id);
CREATE INDEX IF NOT EXISTS idx_invoices_treasury_link ON invoices(linked_treasury_id);
