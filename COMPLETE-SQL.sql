-- ============================================
-- KTC NextTrade Hub — COMPLETE SQL
-- Run ALL of this in Supabase → SQL Editor
-- All statements are safe to re-run (IF NOT EXISTS / IF NOT EXISTS)
-- ============================================

-- === NOTIFICATION LOG ===
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  notif_type TEXT NOT NULL,
  subject TEXT,
  sent BOOLEAN DEFAULT false,
  triggered_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- === TICKETS ===
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_number TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_name TEXT;

-- === WAREHOUSE ===
ALTER TABLE warehouse_expenses ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE warehouse_expenses ADD COLUMN IF NOT EXISTS description_en TEXT;

-- === CATEGORY RULES ===
ALTER TABLE expense_rules ADD COLUMN IF NOT EXISTS rule_type TEXT DEFAULT 'expense';
ALTER TABLE expense_rules ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- === CRM PIPELINE ===
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'lead';

-- === TREASURY (translation + search) ===
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- === MESSAGES (direct email sending) ===
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_by UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS resend_id TEXT;

-- === INVENTORY (photos, quantities, cost tracking) ===
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS original_quantity NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS current_quantity NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC(14,2) DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS purchase_currency TEXT DEFAULT 'USD';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS customs_cost NUMERIC(14,2) DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS customs_currency TEXT DEFAULT 'EGP';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(14,2) DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS shipping_currency TEXT DEFAULT 'USD';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS other_cost NUMERIC(14,2) DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS other_currency TEXT DEFAULT 'EGP';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(10,4) DEFAULT 50;

-- === FIX: Lowercase all emails to match Supabase auth ===
UPDATE users SET email = LOWER(email);

-- === SUPABASE STORAGE ===
-- Go to Supabase → Storage → Create bucket: "product-photos" → Set to PUBLIC

-- ============================================
-- DONE. All safe to re-run.
-- ============================================
