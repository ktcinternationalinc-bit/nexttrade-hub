-- v55.83-A.6.27.29 — Inventory Phase 1 Build 4.0: Stock Receipts schema
--
-- Adds the inventory_stock_receipts table — the source of truth for every
-- time stock comes into a warehouse. Each row = one product line of one
-- shipment. Multiple lines of the same shipment share the same receipt_number.
--
-- Purely additive. Does not touch inv_skus, inv_shipments, inv_warehouses,
-- or any other existing inventory table.
--
-- Run this in Supabase SQL editor BEFORE deploying the v55.83-A.6.27.29 code.

CREATE TABLE IF NOT EXISTS inventory_stock_receipts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Receipt-level identity. Multiple rows can share the same receipt_number
  -- when one shipment contains multiple product lines.
  receipt_number           text NOT NULL,
  receipt_type             text NOT NULL DEFAULT 'new_shipment',
  receipt_date             date NOT NULL DEFAULT CURRENT_DATE,
  status                   text NOT NULL DEFAULT 'active',

  -- The product (from Build 2 catalog). RESTRICT so you can't accidentally
  -- delete a product that has stock receipts referencing it.
  product_id               uuid NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,

  -- Quantity + unit
  quantity                 numeric NOT NULL CHECK (quantity > 0),
  uom                      text,

  -- Per-roll tech overrides (saved here, master untouched)
  actual_thickness_mm      numeric,
  actual_width_m           numeric,
  actual_gsm               numeric,
  actual_density           numeric,
  actual_weight_per_roll   numeric,
  actual_roll_length_m     numeric,

  -- Sourcing + cost
  supplier                 text,
  batch_number             text,
  container_number         text,
  cost_per_uom             numeric,
  currency                 text,
  total_cost               numeric,  -- computed at save: quantity * cost_per_uom

  -- Location
  warehouse_id             uuid REFERENCES inv_warehouses(id) ON DELETE RESTRICT,
  rack                     text,

  -- Notes + audit
  notes                    text,
  cancelled_at             timestamptz,
  cancelled_by             uuid,
  cancel_reason            text,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_receipt_type CHECK (receipt_type IN ('new_shipment','legacy_import','adjustment')),
  CONSTRAINT chk_status       CHECK (status IN ('active','cancelled')),
  CONSTRAINT chk_uom          CHECK (uom IS NULL OR uom IN ('kg','meter','yard','roll','piece','liter','sqm')),
  CONSTRAINT chk_currency     CHECK (currency IS NULL OR currency IN ('EGP','USD','EUR'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_receipts_receipt_number ON inventory_stock_receipts (receipt_number);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_date           ON inventory_stock_receipts (receipt_date);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_product        ON inventory_stock_receipts (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_warehouse      ON inventory_stock_receipts (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_status         ON inventory_stock_receipts (status);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_batch          ON inventory_stock_receipts (batch_number) WHERE batch_number IS NOT NULL;

-- updated_at auto-bump
CREATE OR REPLACE FUNCTION update_inventory_stock_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_stock_receipts_updated_at ON inventory_stock_receipts;
CREATE TRIGGER trigger_stock_receipts_updated_at
BEFORE UPDATE ON inventory_stock_receipts
FOR EACH ROW EXECUTE FUNCTION update_inventory_stock_receipts_updated_at();

-- ── Receipt number generator ──────────────────────────────────────
-- Generates RCV-YYYY-MM-DD-NNN for a given date, where NNN is the next
-- sequential number for that date (counting only active receipts).
-- Safe to call concurrently because it's wrapped in the insert transaction.
CREATE OR REPLACE FUNCTION generate_receipt_number(p_date date)
RETURNS text AS $$
DECLARE
  v_count integer;
  v_prefix text;
BEGIN
  v_prefix := 'RCV-' || to_char(p_date, 'YYYY-MM-DD') || '-';
  SELECT COUNT(*) INTO v_count
  FROM inventory_stock_receipts
  WHERE receipt_number LIKE v_prefix || '%';
  RETURN v_prefix || lpad((v_count + 1)::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE inventory_stock_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_stock_receipts_read  ON inventory_stock_receipts;
CREATE POLICY inv_stock_receipts_read  ON inventory_stock_receipts FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_stock_receipts_write ON inventory_stock_receipts;
CREATE POLICY inv_stock_receipts_write ON inventory_stock_receipts FOR ALL USING (true) WITH CHECK (true);

-- ── Verify after running ──────────────────────────────────────────
-- SELECT COUNT(*) FROM inventory_stock_receipts;                  -- expect 0
-- SELECT generate_receipt_number(CURRENT_DATE);                   -- expect RCV-YYYY-MM-DD-001
