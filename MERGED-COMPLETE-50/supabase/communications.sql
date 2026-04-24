-- Communications Schema for NextTrade Hub
-- Run this in Supabase SQL Editor AFTER the main schema

-- ============================================
-- EMAIL ACCOUNTS (connected Gmail accounts)
-- ============================================
CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  provider TEXT DEFAULT 'gmail',
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_email_accounts_user ON email_accounts(user_id);

-- ============================================
-- UNIFIED MESSAGES (email + WhatsApp + future)
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body TEXT,
  thread_id TEXT,
  external_id TEXT,
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'read', 'draft', 'sent', 'failed', 'pending_approval')),
  is_urgent BOOLEAN DEFAULT false,
  customer_id UUID REFERENCES customers(id),
  handled_by UUID REFERENCES users(id),
  ai_summary TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_channel ON messages(channel);
CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_from ON messages(from_address);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_date ON messages(created_at);
CREATE INDEX idx_messages_customer ON messages(customer_id);

-- ============================================
-- AI COMMUNICATIONS AUDIT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS comms_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action_type TEXT NOT NULL CHECK (action_type IN ('read_email', 'send_email', 'draft_email', 'read_whatsapp', 'send_whatsapp', 'draft_whatsapp', 'create_ticket_from_message', 'create_reminder_from_message', 'summarize', 'search')),
  message_id UUID REFERENCES messages(id),
  triggered_by TEXT DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'ai_assistant', 'auto_rule')),
  user_id UUID REFERENCES users(id),
  input_text TEXT,
  output_text TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_comms_audit_type ON comms_audit(action_type);
CREATE INDEX idx_comms_audit_date ON comms_audit(created_at);

-- ============================================
-- WHATSAPP CONTACTS (linked to customers)
-- ============================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

-- ============================================
-- RLS
-- ============================================
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON email_accounts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON email_accounts FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON messages FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON messages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON comms_audit FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON comms_audit FOR ALL USING (auth.role() = 'authenticated');
