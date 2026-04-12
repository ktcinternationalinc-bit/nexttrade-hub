-- Add logout_reason to user_sessions
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS logout_reason TEXT;
-- Values: 'manual' (user clicked clock out), 'auto_timeout' (30 min inactivity), NULL (page closed / unknown)

-- Add attachments to tickets (JSONB array of file objects)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
-- Each attachment: { "name": "filename.pdf", "url": "https://...", "size": 12345, "type": "application/pdf", "uploaded_at": "...", "uploaded_by": "uuid" }

-- Index for session queries
CREATE INDEX IF NOT EXISTS idx_sessions_date ON user_sessions(date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_reason ON user_sessions(logout_reason);
