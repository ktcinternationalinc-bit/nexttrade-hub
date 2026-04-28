-- NextTrade Hub - Phase 1 Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & ROLES
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'accountant', 'viewer')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CUSTOMERS
-- ============================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  name_ar TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_name_ar ON customers(name_ar);

-- ============================================
-- SALES / INVOICES
-- ============================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT, -- denormalized for quick display
  invoice_date DATE NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_rep TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'treasury')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_order ON invoices(order_number);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);

-- ============================================
-- INVOICE LINE ITEMS (for drill-down)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ============================================
-- TREASURY TRANSACTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS treasury (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_date DATE NOT NULL,
  order_number TEXT,
  description TEXT,
  cash_in NUMERIC(14,2) DEFAULT 0,
  cash_out NUMERIC(14,2) DEFAULT 0,
  category TEXT,
  source TEXT DEFAULT 'main' CHECK (source IN ('main', 'emad', 'manual')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_treasury_date ON treasury(transaction_date);
CREATE INDEX idx_treasury_order ON treasury(order_number);
CREATE INDEX idx_treasury_category ON treasury(category);

-- ============================================
-- EXPENSE CATEGORIES (learnable rules)
-- ============================================
CREATE TABLE IF NOT EXISTS expense_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description_match TEXT NOT NULL,
  category TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CHECKS
-- ============================================
CREATE TABLE IF NOT EXISTS checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  order_number TEXT,
  amount NUMERIC(14,2) NOT NULL,
  check_date TEXT, -- YYYY-MM format
  collection_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'collected', 'bounced')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_checks_status ON checks(status);
CREATE INDEX idx_checks_date ON checks(check_date);

-- ============================================
-- DEBTS
-- ============================================
CREATE TABLE IF NOT EXISTS debts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  total_debt NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- WAREHOUSE EXPENSES
-- ============================================
CREATE TABLE IF NOT EXISTS warehouse_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  category TEXT,
  america_ref TEXT, -- America reference number
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_warehouse_date ON warehouse_expenses(expense_date);

-- ============================================
-- AUDIT TRAIL
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changed_by UUID REFERENCES users(id),
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_table ON audit_log(table_name);
CREATE INDEX idx_audit_record ON audit_log(record_id);
CREATE INDEX idx_audit_date ON audit_log(created_at);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury ENABLE ROW LEVEL SECURITY;
ALTER TABLE checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_rules ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all data
CREATE POLICY "Authenticated read" ON users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON customers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON invoices FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON invoice_items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON treasury FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON checks FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON debts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON warehouse_expenses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON audit_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read" ON expense_rules FOR SELECT USING (auth.role() = 'authenticated');

-- Allow authenticated users to write (role checks in app layer)
CREATE POLICY "Authenticated write" ON customers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON invoices FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON invoice_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON treasury FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON checks FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON debts FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON warehouse_expenses FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON audit_log FOR INSERT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write" ON expense_rules FOR ALL USING (auth.role() = 'authenticated');

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_timestamp BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_customers_timestamp BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_invoices_timestamp BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_treasury_timestamp BEFORE UPDATE ON treasury FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_checks_timestamp BEFORE UPDATE ON checks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_warehouse_timestamp BEFORE UPDATE ON warehouse_expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-calculate invoice outstanding
CREATE OR REPLACE FUNCTION calc_outstanding()
RETURNS TRIGGER AS $$
BEGIN
  NEW.outstanding = GREATEST(0, NEW.total_amount - NEW.total_collected);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calc_invoice_outstanding BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION calc_outstanding();

-- Categorize treasury expenses automatically
CREATE OR REPLACE FUNCTION auto_categorize_expense()
RETURNS TRIGGER AS $$
DECLARE
  rule RECORD;
BEGIN
  IF NEW.cash_out > 0 AND NEW.category IS NULL THEN
    SELECT category INTO rule FROM expense_rules 
    WHERE NEW.description ILIKE '%' || description_match || '%' 
    LIMIT 1;
    IF FOUND THEN
      NEW.category = rule.category;
    ELSE
      NEW.category = 'Operations';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_cat_treasury BEFORE INSERT ON treasury FOR EACH ROW EXECUTE FUNCTION auto_categorize_expense();

-- ============================================
-- PHASE 2: CRM & TICKETING
-- ============================================

-- CLIENT GROUPS
CREATE TABLE IF NOT EXISTS client_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CRM CLIENTS (extends customers)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_type TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_source TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS group_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS commercial_reg TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_contact TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- CRM NOTES
CREATE TABLE IF NOT EXISTS client_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notes_customer ON client_notes(customer_id);
CREATE INDEX idx_notes_date ON client_notes(created_at);

-- FOLLOW-UPS
CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id),
  task TEXT NOT NULL,
  due_date DATE NOT NULL,
  due_time TIME,
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_followups_assigned ON follow_ups(assigned_to);
CREATE INDEX idx_followups_due ON follow_ups(due_date);

-- TICKETS
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  customer_id UUID REFERENCES customers(id),
  order_number TEXT,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New','Acknowledged','In Progress','Blocked','On Hold','Waiting','Review','Testing','Ready','Closed','Reopened')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  assigned_to UUID REFERENCES users(id),
  due_date DATE,
  created_by UUID REFERENCES users(id),
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assigned ON tickets(assigned_to);
CREATE INDEX idx_tickets_due ON tickets(due_date);

-- TICKET COMMENTS
CREATE TABLE IF NOT EXISTS ticket_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_comments_ticket ON ticket_comments(ticket_id);

-- CALENDAR EVENTS
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME,
  event_type TEXT DEFAULT 'task' CHECK (event_type IN ('task','meeting','call','visit')),
  recurring TEXT CHECK (recurring IN ('none','daily','weekly','biweekly','monthly','custom')),
  recurring_end DATE,
  recurring_days INT[],
  assigned_to UUID REFERENCES users(id),
  customer_id UUID REFERENCES customers(id),
  completed BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_events_date ON calendar_events(event_date);
CREATE INDEX idx_events_assigned ON calendar_events(assigned_to);

-- DAILY LOG
CREATE TABLE IF NOT EXISTS daily_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  log_time TIME NOT NULL DEFAULT CURRENT_TIME,
  entry_text TEXT NOT NULL,
  auto_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_daily_user ON daily_log(user_id);
CREATE INDEX idx_daily_date ON daily_log(log_date);

-- MODULE PERMISSIONS
CREATE TABLE IF NOT EXISTS module_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  module_name TEXT NOT NULL,
  has_access BOOLEAN DEFAULT false,
  UNIQUE(user_id, module_name)
);

-- NOTIFICATION PREFERENCES
CREATE TABLE IF NOT EXISTS notification_prefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  notif_type TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  UNIQUE(user_id, notif_type)
);

-- Update users table for role hierarchy
ALTER TABLE users ADD COLUMN IF NOT EXISTS reports_to UUID REFERENCES users(id);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'team', 'viewer'));

-- RLS for new tables
ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON client_notes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON client_notes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON follow_ups FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON follow_ups FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON tickets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON tickets FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON ticket_comments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON ticket_comments FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON calendar_events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON calendar_events FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON daily_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON daily_log FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON module_permissions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON module_permissions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON notification_prefs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON notification_prefs FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON client_groups FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON client_groups FOR ALL USING (auth.role() = 'authenticated');

-- Triggers
CREATE TRIGGER update_tickets_timestamp BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-log function for daily log
CREATE OR REPLACE FUNCTION auto_daily_log()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO daily_log (user_id, entry_text, auto_generated)
  VALUES (
    COALESCE(NEW.created_by, NEW.assigned_to),
    TG_ARGV[0] || ': ' || COALESCE(NEW.title, NEW.note_text, NEW.task, NEW.entry_text, ''),
    true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SHIPMENTS / CUSTOMS
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  container_type TEXT DEFAULT '20ft' CHECK (container_type IN ('20ft','40ft','40ft HC','LCL')),
  container_count INT DEFAULT 1,
  broker_name TEXT,
  rate_usd NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In Transit','At Port','Clearing','Cleared','Delivered')),
  customer_id UUID REFERENCES customers(id),
  order_number TEXT,
  notes TEXT,
  eta DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_shipments_status ON shipments(status);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON shipments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write" ON shipments FOR ALL USING (auth.role() = 'authenticated');

-- Add Customs to module permissions
CREATE TRIGGER update_shipments_timestamp BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
