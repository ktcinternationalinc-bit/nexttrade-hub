-- Notification log table
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  notif_type TEXT NOT NULL,
  subject TEXT,
  sent BOOLEAN DEFAULT false,
  triggered_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON notification_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON notification_log FOR ALL USING (auth.role() = 'authenticated');
