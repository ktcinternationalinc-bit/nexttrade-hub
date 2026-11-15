-- v55.83-A.6.27.63 — FX P&L tracking.
--
-- ──────────────────────────────────────────────────────────────────
-- WHAT THIS DOES (in plain English)
-- ──────────────────────────────────────────────────────────────────
-- Right now your P&L mixes two things:
--   1. REAL MARGIN — what you'd earn if USD/EGP stayed constant
--   2. FX GAIN/LOSS — extra profit (or loss) from currency movement
--      between when you bought stock and when you sold it
--
-- This build separates them. It adds:
--   • An fx_rates table where you record what the USD/EGP rate was on
--     any given day. The portal will use it for all FX math.
--   • Two new columns on inventory_layers (when stock was RECEIVED):
--       - cost_egp_at_receipt: how many EGP this unit cost on receipt day
--       - fx_rate_at_receipt:  the USD/EGP rate used for that conversion
--   • Two new columns on inventory_movements (when stock SOLD or moved):
--       - cost_egp_at_sale:    same cost but converted at SALE-day rate
--       - fx_rate_at_sale:     the USD/EGP rate at sale time
--
-- Then on the new FX Report, you'll see:
--   • REAL MARGIN     = revenue EGP - cost_egp_at_receipt (per movement)
--   • REALIZED FX P&L = cost_egp_at_sale - cost_egp_at_receipt (per movement)
--   • UNREALIZED FX   = (today's_rate × USD_cost) - cost_egp_at_receipt (for stock still on hand)
--
-- ALL ADDITIVE — nothing existing breaks. Older rows just have NULL in
-- the new columns; the report has a graceful fallback.

-- ──────────────────────────────────────────────────────────────────
-- 1. fx_rates table — daily rate log
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fx_rates (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rate_date     DATE NOT NULL,
  from_currency TEXT NOT NULL,                  -- e.g. 'USD'
  to_currency   TEXT NOT NULL,                  -- e.g. 'EGP'
  rate          NUMERIC(14,6) NOT NULL,         -- 1 USD = N EGP (so usually ~50 for USD→EGP)
  source        TEXT,                           -- e.g. 'CBE', 'banking app', 'manual', 'API'
  notes         TEXT,

  -- Audit
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID,

  CONSTRAINT chk_fx_rate_positive CHECK (rate > 0),
  CONSTRAINT chk_fx_from_not_blank CHECK (length(trim(from_currency)) >= 2),
  CONSTRAINT chk_fx_to_not_blank   CHECK (length(trim(to_currency))   >= 2),
  CONSTRAINT chk_fx_different_currencies CHECK (from_currency <> to_currency)
);

-- One rate per (date, from→to) — last entry wins on conflict
DO $$ BEGIN
  ALTER TABLE fx_rates
    ADD CONSTRAINT uniq_fx_rate_date_pair UNIQUE (rate_date, from_currency, to_currency);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_fx_rates_date_pair ON fx_rates (rate_date DESC, from_currency, to_currency);

-- ──────────────────────────────────────────────────────────────────
-- 2. FX snapshot columns on inventory_layers (receipt side)
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE inventory_layers
  ADD COLUMN IF NOT EXISTS cost_egp_at_receipt NUMERIC(14,2);
ALTER TABLE inventory_layers
  ADD COLUMN IF NOT EXISTS fx_rate_at_receipt  NUMERIC(14,6);

-- ──────────────────────────────────────────────────────────────────
-- 3. FX snapshot columns on inventory_movements (sale/movement side)
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS cost_egp_at_sale NUMERIC(14,2);
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS fx_rate_at_sale  NUMERIC(14,6);

-- ──────────────────────────────────────────────────────────────────
-- 4. Helper function: get the EFFECTIVE FX rate for a date.
--    Returns the rate logged for that exact date, OR the most recent
--    rate BEFORE that date, OR NULL if no rate has ever been logged.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fx_rate_for_date(
  p_from TEXT,
  p_to   TEXT,
  p_date DATE
) RETURNS NUMERIC AS $$
  SELECT rate
  FROM fx_rates
  WHERE from_currency = p_from
    AND to_currency   = p_to
    AND rate_date     <= p_date
  ORDER BY rate_date DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ──────────────────────────────────────────────────────────────────
-- 5. RLS — permissive (app-level access control)
-- ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow all on fx_rates" ON fx_rates FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 6. Seed: today's USD→EGP rate placeholder
--    (Comment line — uncomment + edit before running if you want to
--    seed an initial rate. The portal will also let you add rates
--    via the new FX Rates admin page.)
-- ──────────────────────────────────────────────────────────────────
-- INSERT INTO fx_rates (rate_date, from_currency, to_currency, rate, source, notes)
-- VALUES (CURRENT_DATE, 'USD', 'EGP', 50.00, 'manual', 'Initial seed')
-- ON CONFLICT (rate_date, from_currency, to_currency) DO UPDATE SET rate = EXCLUDED.rate;

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration)
-- ──────────────────────────────────────────────────────────────────
-- 1) Table + 4 new columns exist:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name IN ('fx_rates', 'inventory_layers', 'inventory_movements')
--      AND column_name IN ('rate','cost_egp_at_receipt','fx_rate_at_receipt','cost_egp_at_sale','fx_rate_at_sale')
--    ORDER BY table_name, column_name;
--    Expected: 5 rows
--
-- 2) Unique constraint exists:
--    SELECT conname FROM pg_constraint WHERE conname = 'uniq_fx_rate_date_pair';
--    Expected: 1 row
--
-- 3) Test the helper function:
--    SELECT fx_rate_for_date('USD', 'EGP', CURRENT_DATE);
--    Expected: NULL until you've logged a rate; numeric after.

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT (only if catastrophic)
-- ──────────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS fx_rate_for_date(TEXT, TEXT, DATE);
--   ALTER TABLE inventory_movements DROP COLUMN IF EXISTS fx_rate_at_sale;
--   ALTER TABLE inventory_movements DROP COLUMN IF EXISTS cost_egp_at_sale;
--   ALTER TABLE inventory_layers    DROP COLUMN IF EXISTS fx_rate_at_receipt;
--   ALTER TABLE inventory_layers    DROP COLUMN IF EXISTS cost_egp_at_receipt;
--   DROP TABLE IF EXISTS fx_rates;
