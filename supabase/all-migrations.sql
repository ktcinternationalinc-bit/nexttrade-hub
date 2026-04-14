-- ============================================================
-- KTC NextTrade Hub — Complete SQL Migrations
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- ============================================================

-- ===== ANNOUNCEMENTS (dashboard broadcast) =====
CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  priority TEXT DEFAULT 'info',
  pinned BOOLEAN DEFAULT false,
  target_user UUID,
  posted_by UUID,
  active BOOLEAN DEFAULT true,
  send_email BOOLEAN DEFAULT false,
  send_whatsapp BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all announcements" ON announcements FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== QUOTE COMPANIES =====
CREATE TABLE IF NOT EXISTS quote_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_url TEXT,
  tax_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE quote_companies ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all quote_companies" ON quote_companies FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== CUSTOMER QUOTES =====
CREATE TABLE IF NOT EXISTS customer_quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_number TEXT,
  company_id UUID REFERENCES quote_companies(id),
  client_name TEXT,
  client_email TEXT,
  date DATE,
  validity_days INTEGER DEFAULT 30,
  currency TEXT DEFAULT 'USD',
  include_vat BOOLEAN DEFAULT false,
  vat_rate NUMERIC(5,2) DEFAULT 14,
  line_items JSONB DEFAULT '[]',
  notes TEXT,
  internal_notes TEXT,
  status TEXT DEFAULT 'draft',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE customer_quotes ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all customer_quotes" ON customer_quotes FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== BANK CONNECTIONS (Plaid) =====
CREATE TABLE IF NOT EXISTS bank_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plaid_item_id TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT DEFAULT 'Unknown Bank',
  status TEXT DEFAULT 'active',
  last_synced TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all bank_connections" ON bank_connections FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== BANK TRANSACTIONS =====
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID REFERENCES bank_connections(id) ON DELETE CASCADE,
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  name TEXT,
  merchant_name TEXT,
  category TEXT,
  pending BOOLEAN DEFAULT false,
  account_id TEXT,
  matched_invoice_id UUID,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txn_matched ON bank_transactions(matched_invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_connection ON bank_transactions(connection_id);
DO $$ BEGIN
  ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all bank_transactions" ON bank_transactions FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== USER SESSIONS (login/logout tracking) =====
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  login_at TIMESTAMPTZ NOT NULL,
  logout_at TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON user_sessions(user_id, date DESC);
DO $$ BEGIN
  ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all user_sessions" ON user_sessions FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== TEAM REMINDERS =====
CREATE TABLE IF NOT EXISTS team_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  assigned_to UUID,
  title TEXT NOT NULL,
  body TEXT,
  reminder_date DATE,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE team_reminders ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all team_reminders" ON team_reminders FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== NOTIFICATIONS TABLE =====
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  type TEXT,
  title TEXT,
  body TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all notifications" ON notifications FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== SAFE COLUMN ADDITIONS (won't error if already exist) =====

-- Warehouse expenses: add subcategory if missing
DO $$ BEGIN
  ALTER TABLE warehouse_expenses ADD COLUMN IF NOT EXISTS subcategory TEXT;
EXCEPTION WHEN others THEN NULL; END $$;

-- Tickets: add acknowledged, multi-assign columns if missing
DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN DEFAULT false;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS acknowledged_by UUID;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_users JSONB DEFAULT '[]';
EXCEPTION WHEN others THEN NULL; END $$;

-- Invoices: add product_type if missing
DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS product_type TEXT;
EXCEPTION WHEN others THEN NULL; END $$;

-- Inventory inbounds: add product_type if missing
DO $$ BEGIN
  ALTER TABLE inventory_inbounds ADD COLUMN IF NOT EXISTS product_type TEXT;
EXCEPTION WHEN others THEN NULL; END $$;

-- Shipping rates: add rate_type if missing
DO $$ BEGIN
  ALTER TABLE shipping_rates ADD COLUMN IF NOT EXISTS rate_type TEXT;
EXCEPTION WHEN others THEN NULL; END $$;

-- CRM: add assigned_rep if missing
DO $$ BEGIN
  ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_rep UUID;
EXCEPTION WHEN others THEN NULL; END $$;

-- Communications threads
CREATE TABLE IF NOT EXISTS comm_threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel TEXT DEFAULT 'email',
  subject TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT DEFAULT 'open',
  assigned_to UUID,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comm_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID REFERENCES comm_threads(id) ON DELETE CASCADE,
  direction TEXT DEFAULT 'outbound',
  body TEXT,
  sender_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE comm_threads ENABLE ROW LEVEL SECURITY;
  ALTER TABLE comm_messages ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all comm_threads" ON comm_threads FOR ALL USING (true);
  CREATE POLICY "Allow all comm_messages" ON comm_messages FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Module permissions
CREATE TABLE IF NOT EXISTS module_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  module_name TEXT NOT NULL,
  has_access BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE module_permissions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all module_permissions" ON module_permissions FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notification settings
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_type TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT true,
  whatsapp_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all notification_settings" ON notification_settings FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
