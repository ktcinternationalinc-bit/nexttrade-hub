-- v55.83-A.6.27.44b — Invoice line-item inventory linkage
-- (44a added the columns to the invoices table itself; this adds them to
--  invoice_items so each LINE can be tagged independently.)

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS uses_inventory boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES inventory_products(id),
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS sale_quantity numeric(12,3),
  ADD COLUMN IF NOT EXISTS sale_price_per_uom numeric(14,2),
  ADD COLUMN IF NOT EXISTS consumed_layers jsonb,
  ADD COLUMN IF NOT EXISTS cogs_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS gross_profit numeric(14,2),
  ADD COLUMN IF NOT EXISTS inventory_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inventory_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS backorder_qty numeric(12,3) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_invoice_items_variant_id
  ON invoice_items (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_items_uses_inventory
  ON invoice_items (uses_inventory) WHERE uses_inventory = true;

-- ── Verify ──────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM information_schema.columns WHERE table_name='invoice_items'
--   AND column_name IN ('uses_inventory','variant_id','warehouse_id','uom','sale_quantity','sale_price_per_uom','consumed_layers','cogs_total','gross_profit','inventory_consumed_at','inventory_status','backorder_qty');
-- Expect: 12
