-- ============================================================
-- v55.51 — Customs tab Phase 1
--
-- Adds three tables:
--   1. customs_rates       — master library of products + customs duty %
--   2. customs_settings    — singleton row holding government rates
--                            (VAT, advance income tax, bank commission)
--   3. customs_clearances  — actual clearance records, one per container
--                            with all calculations + fixed fees + total
--
-- Why values are SNAPSHOTTED on customs_clearances:
--   When a government rate changes (e.g. VAT goes from 14% to 15%) we
--   don't want last year's clearances to retroactively recalculate. So
--   every clearance row stores the rates that were in effect AT THE TIME
--   of that clearance, plus the calculated EGP amounts. Future changes
--   to customs_rates / customs_settings only affect new clearances.
--
-- Run order: just run the whole file in Supabase SQL editor.
-- ============================================================

-- ---------- customs_rates ----------
CREATE TABLE IF NOT EXISTS customs_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_name TEXT NOT NULL UNIQUE,
  product_name_ar TEXT,
  customs_duty_pct NUMERIC NOT NULL CHECK (customs_duty_pct >= 0 AND customs_duty_pct <= 100),
  notes TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID
);

DO $$ BEGIN ALTER TABLE customs_rates ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all customs_rates" ON customs_rates FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- customs_settings (singleton) ----------
CREATE TABLE IF NOT EXISTS customs_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vat_pct NUMERIC NOT NULL DEFAULT 14.0,
  advance_income_tax_pct NUMERIC NOT NULL DEFAULT 1.0,
  bank_commission_pct NUMERIC NOT NULL DEFAULT 10.0,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

INSERT INTO customs_settings (id, vat_pct, advance_income_tax_pct, bank_commission_pct)
VALUES (1, 14.0, 1.0, 10.0)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN ALTER TABLE customs_settings ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all customs_settings" ON customs_settings FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- customs_clearances ----------
CREATE TABLE IF NOT EXISTS customs_clearances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_number TEXT,
  shipment_id UUID,
  clearance_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Product info (snapshotted from customs_rates at save time)
  product_name TEXT,
  customs_duty_pct NUMERIC,

  -- User inputs
  usd_price_per_kg NUMERIC,
  quantity_kg NUMERIC,
  fx_rate NUMERIC,

  -- Calculated values (stored for historical accuracy)
  total_usd NUMERIC,
  total_egp NUMERIC,
  customs_duty_egp NUMERIC,
  vat_egp NUMERIC,
  advance_income_tax_egp NUMERIC,
  bank_commission_egp NUMERIC,

  -- Snapshotted government rates
  vat_pct NUMERIC,
  advance_income_tax_pct NUMERIC,
  bank_commission_pct NUMERIC,

  -- Fixed fees (all EGP)
  permit_withdrawal_egp NUMERIC,
  unloading_egp NUMERIC,
  cranes_loading_egp NUMERIC,
  storage_egp NUMERIC,
  road_fees_egp NUMERIC,
  pricing_committee_egp NUMERIC,
  misc_clearance_egp NUMERIC,
  transport_egp NUMERIC,

  -- Grand total of EVERYTHING above
  total_clearance_egp NUMERIC,

  -- Status tracking
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','paid','reconciled','cancelled')),
  paid_at TIMESTAMPTZ,
  paid_by UUID,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_customs_clearances_shipment ON customs_clearances(shipment_id);
CREATE INDEX IF NOT EXISTS idx_customs_clearances_date ON customs_clearances(clearance_date);
CREATE INDEX IF NOT EXISTS idx_customs_clearances_status ON customs_clearances(status);
CREATE INDEX IF NOT EXISTS idx_customs_clearances_ref ON customs_clearances(reference_number);

DO $$ BEGIN ALTER TABLE customs_clearances ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all customs_clearances" ON customs_clearances FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Verify ----------
-- After running, you should see 3 tables. Check with:
--   SELECT * FROM customs_settings;       -- expect 1 row, defaults 14/1/10
--   SELECT * FROM customs_rates;          -- expect 0 rows (you'll add as you go)
--   SELECT * FROM customs_clearances;     -- expect 0 rows
