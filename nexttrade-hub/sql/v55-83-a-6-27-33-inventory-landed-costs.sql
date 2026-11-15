-- v55.83-A.6.27.33 — Inventory Phase 1 Build 4.2: Landed Cost Finalization
--
-- Adds:
--   1. inventory_landed_costs table — one row per receipt, holds the freight/
--      customs/duty/insurance/clearing/transport/other cost components plus
--      the FX rate and allocation method used.
--   2. Six columns on inventory_stock_receipts — final landed cost per UOM,
--      landed total, allocation method, FX rate, finalization timestamp/user.
--
-- Purely additive. Existing receipts (status='active' or 'received') are
-- unaffected until the user runs Finalize Cost on each.

-- ── New table: cost-component breakdown per receipt ──────────────
CREATE TABLE IF NOT EXISTS inventory_landed_costs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number           text NOT NULL,

  -- The six standard cost components
  freight_amount           numeric DEFAULT 0,
  freight_currency         text,
  customs_duty_amount      numeric DEFAULT 0,
  customs_duty_currency    text,
  insurance_amount         numeric DEFAULT 0,
  insurance_currency       text,
  clearing_amount          numeric DEFAULT 0,
  clearing_currency        text,
  local_transport_amount   numeric DEFAULT 0,
  local_transport_currency text,
  other_amount             numeric DEFAULT 0,
  other_currency           text,
  other_description        text,

  -- Conversion + allocation context
  fx_rate_usd_to_egp       numeric,
  fx_source                text,  -- 'api', 'manual', or 'cached'
  fx_rate_date             date,
  total_usd_value          numeric,  -- sum of all components converted to USD
  total_egp_value          numeric,  -- sum converted to EGP at the chosen rate

  -- The base cost (purchase cost before landed) — captured for restatement audits
  base_purchase_total      numeric,
  base_purchase_currency   text,

  -- Allocation method used to split across lines
  allocation_method        text NOT NULL DEFAULT 'by_qty',

  notes                    text,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_allocation_method CHECK (allocation_method IN ('by_qty','by_kg','by_value')),
  CONSTRAINT chk_freight_currency         CHECK (freight_currency         IS NULL OR freight_currency         IN ('EGP','USD','EUR')),
  CONSTRAINT chk_customs_duty_currency    CHECK (customs_duty_currency    IS NULL OR customs_duty_currency    IN ('EGP','USD','EUR')),
  CONSTRAINT chk_insurance_currency       CHECK (insurance_currency       IS NULL OR insurance_currency       IN ('EGP','USD','EUR')),
  CONSTRAINT chk_clearing_currency        CHECK (clearing_currency        IS NULL OR clearing_currency        IN ('EGP','USD','EUR')),
  CONSTRAINT chk_local_transport_currency CHECK (local_transport_currency IS NULL OR local_transport_currency IN ('EGP','USD','EUR')),
  CONSTRAINT chk_other_currency           CHECK (other_currency           IS NULL OR other_currency           IN ('EGP','USD','EUR')),
  CONSTRAINT chk_base_purchase_currency   CHECK (base_purchase_currency   IS NULL OR base_purchase_currency   IN ('EGP','USD','EUR'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_costs_receipt_number ON inventory_landed_costs (receipt_number);
CREATE INDEX IF NOT EXISTS idx_landed_costs_fx_date ON inventory_landed_costs (fx_rate_date) WHERE fx_rate_date IS NOT NULL;

-- updated_at auto-bump
CREATE OR REPLACE FUNCTION update_inventory_landed_costs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_landed_costs_updated_at ON inventory_landed_costs;
CREATE TRIGGER trigger_landed_costs_updated_at
BEFORE UPDATE ON inventory_landed_costs
FOR EACH ROW EXECUTE FUNCTION update_inventory_landed_costs_updated_at();

ALTER TABLE inventory_landed_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_landed_costs_read  ON inventory_landed_costs;
CREATE POLICY inv_landed_costs_read  ON inventory_landed_costs FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_landed_costs_write ON inventory_landed_costs;
CREATE POLICY inv_landed_costs_write ON inventory_landed_costs FOR ALL USING (true) WITH CHECK (true);

-- ── New columns on inventory_stock_receipts ──────────────────────
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS landed_cost_per_uom numeric;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS landed_total        numeric;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS finalized_at        timestamptz;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS finalized_by        uuid;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS allocation_method   text;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS fx_rate_used        numeric;

-- Index on finalized status for reports
CREATE INDEX IF NOT EXISTS idx_stock_receipts_finalized ON inventory_stock_receipts (finalized_at) WHERE finalized_at IS NOT NULL;

-- ── Verify ───────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM inventory_landed_costs;        -- expect 0
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'inventory_stock_receipts'
--   AND column_name IN ('landed_cost_per_uom','landed_total','finalized_at','finalized_by','allocation_method','fx_rate_used');
-- Expect: 6 rows
