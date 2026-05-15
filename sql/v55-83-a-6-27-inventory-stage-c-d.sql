-- v55.83-A.6.27 (Max May 14 2026) — Inventory Stage C + D combined.
--
-- Adds full per-shipment landed cost tracking and FIFO sale deduction.
-- Per Max:
--   • Per-shipment cost basis (each container its own layer)
--   • FX: default to API, allow manual override
--   • Store landed cost in BOTH USD and EGP, snapshot FX at finalize time
--   • Allow sales to deduct from shipments before all costs are entered
--   • Cost adjustments later RESTATE COGS on prior sales (audit trail)
--
-- This file is idempotent — safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────
-- Part 1: Shipment-level landed cost finalization
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE inv_shipments
  ADD COLUMN IF NOT EXISTS total_landed_cost_usd NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS total_landed_cost_egp NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS allocation_method TEXT DEFAULT 'by_qty'
    CHECK (allocation_method IN ('by_qty', 'by_kg', 'by_value')),
  ADD COLUMN IF NOT EXISTS fx_usd_to_egp NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS fx_source TEXT,                     -- 'api:<name>' or 'manual'
  ADD COLUMN IF NOT EXISTS fx_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost_finalized_by UUID REFERENCES users(id);

COMMENT ON COLUMN inv_shipments.total_landed_cost_usd IS
  'Sum of every cost component converted to USD, locked at cost_finalized_at.';
COMMENT ON COLUMN inv_shipments.total_landed_cost_egp IS
  'Same total in EGP, using the fx_usd_to_egp snapshot.';
COMMENT ON COLUMN inv_shipments.allocation_method IS
  'How total_landed_cost is split across SKUs: by_qty | by_kg | by_value.';
COMMENT ON COLUMN inv_shipments.fx_usd_to_egp IS
  'USD→EGP rate snapshot at finalize time. Immutable after finalize.';

-- ─────────────────────────────────────────────────────────────────────────
-- Part 2: Per-shipment per-SKU landed cost (immutable cost basis)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE inv_shipment_skus
  ADD COLUMN IF NOT EXISTS allocated_cost_usd NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS allocated_cost_egp NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS landed_unit_cost_usd NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS landed_unit_cost_egp NUMERIC(18,6);

COMMENT ON COLUMN inv_shipment_skus.allocated_cost_usd IS
  'This SKU line''s share of the total landed cost in USD.';
COMMENT ON COLUMN inv_shipment_skus.landed_unit_cost_usd IS
  'Per-unit landed cost = allocated_cost_usd / qty_primary. Locked at finalize.';

-- ─────────────────────────────────────────────────────────────────────────
-- Part 3: Inventory layers — one row per receipt, drained FIFO on sale
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inv_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES inv_skus(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES inv_warehouses(id) ON DELETE SET NULL,
  -- Source: the shipment + the specific shipment_sku line this layer came from
  source_shipment_id UUID REFERENCES inv_shipments(id) ON DELETE SET NULL,
  source_shipment_sku_id UUID REFERENCES inv_shipment_skus(id) ON DELETE SET NULL,
  -- Quantities
  qty_received NUMERIC(14,3) NOT NULL,
  qty_remaining NUMERIC(14,3) NOT NULL,
  -- Cost basis (locked at receipt time; cost adjustments later restate via inv_cost_adjustments)
  landed_unit_cost_usd NUMERIC(18,6),
  landed_unit_cost_egp NUMERIC(18,6),
  fx_usd_to_egp NUMERIC(18,8),
  -- Provisional flag — layer exists but shipment costs aren't fully finalized yet.
  -- Sales can still drain a provisional layer (per Max's "allow it" decision),
  -- but COGS values get restated when the layer's cost is finalized.
  cost_is_provisional BOOLEAN NOT NULL DEFAULT TRUE,
  -- Timestamps
  received_at DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inv_layers_sku_warehouse_received
  ON inv_layers(sku_id, warehouse_id, received_at);
CREATE INDEX IF NOT EXISTS idx_inv_layers_remaining
  ON inv_layers(sku_id, warehouse_id) WHERE qty_remaining > 0;

COMMENT ON TABLE inv_layers IS
  'FIFO cost layers. One per receipt. Sales drain oldest-first via consumed_layers.';

-- ─────────────────────────────────────────────────────────────────────────
-- Part 4: Movements get cost stamping
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE inv_movements
  ADD COLUMN IF NOT EXISTS unit_cost_usd NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS unit_cost_egp NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS total_cost_egp NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS consumed_layers JSONB,
  ADD COLUMN IF NOT EXISTS linked_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_invoice_item_id UUID;

COMMENT ON COLUMN inv_movements.consumed_layers IS
  'For sale movements: JSON array of {layer_id, qty_drained, unit_cost_usd, unit_cost_egp}.';
COMMENT ON COLUMN inv_movements.unit_cost_usd IS
  'Weighted average unit cost across consumed_layers (for reporting convenience).';

-- ─────────────────────────────────────────────────────────────────────────
-- Part 5: Invoice line items get SKU + COGS linkage
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS inv_sku_id UUID REFERENCES inv_skus(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inv_warehouse_id UUID REFERENCES inv_warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cogs_usd NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS cogs_egp NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS cogs_movement_id UUID REFERENCES inv_movements(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoice_items.inv_sku_id IS
  'Optional link to the inventory SKU. When set + qty present, save triggers a sale movement that drains FIFO layers.';
COMMENT ON COLUMN invoice_items.cogs_usd IS
  'Snapshot of COGS at the time of sale, in USD. May be restated by cost adjustments later — see cogs_movement_id.consumed_layers.';

-- ─────────────────────────────────────────────────────────────────────────
-- Part 6: Cost adjustment audit log (when a layer's cost changes after sales)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inv_cost_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_id UUID NOT NULL REFERENCES inv_layers(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES inv_shipments(id) ON DELETE SET NULL,
  -- What changed
  field_changed TEXT NOT NULL,         -- 'landed_unit_cost_usd' | 'fx' | 'allocation'
  old_value NUMERIC(18,6),
  new_value NUMERIC(18,6),
  delta NUMERIC(18,6),
  -- COGS restatement summary
  affected_movement_ids UUID[],
  total_cogs_delta_usd NUMERIC(18,4),
  total_cogs_delta_egp NUMERIC(18,4),
  reason TEXT,
  -- Who/when
  adjusted_by UUID REFERENCES users(id),
  adjusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_cost_adjustments_layer
  ON inv_cost_adjustments(layer_id);

COMMENT ON TABLE inv_cost_adjustments IS
  'Append-only audit log of cost basis changes after sales have already drained from a layer.';

-- ─────────────────────────────────────────────────────────────────────────
-- Part 7: FX rate cache
-- ─────────────────────────────────────────────────────────────────────────
--
-- NOTE: inv_fx_rates already exists from the foundation schema
-- (sql/v55-83-a-inventory-schema.sql) with columns:
--   id, from_currency, to_currency, rate, rate_date, source, set_by, notes, created_at
--
-- We REUSE that table. The cost engine in src/lib/inventory-fx.js has been
-- updated to use those column names. No schema changes needed here.
--
-- If you DON'T have inv_fx_rates yet (skipped the foundation SQL), uncomment
-- and run this block:
--
-- CREATE TABLE IF NOT EXISTS inv_fx_rates (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   from_currency TEXT NOT NULL,
--   to_currency TEXT NOT NULL,
--   rate NUMERIC(18,8) NOT NULL,
--   rate_date DATE NOT NULL,
--   source TEXT NOT NULL DEFAULT 'manual',
--   set_by UUID,
--   notes TEXT,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--   CONSTRAINT inv_fx_rates_unique UNIQUE (from_currency, to_currency, rate_date)
-- );
-- CREATE INDEX IF NOT EXISTS idx_inv_fx_rates_lookup
--   ON inv_fx_rates (from_currency, to_currency, rate_date DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Part 8: Verification queries
-- ─────────────────────────────────────────────────────────────────────────

SELECT 'Schema check:' as status;
SELECT 'inv_layers' AS table_name, COUNT(*) AS exists_check FROM information_schema.tables WHERE table_name = 'inv_layers'
UNION ALL SELECT 'inv_cost_adjustments', COUNT(*) FROM information_schema.tables WHERE table_name = 'inv_cost_adjustments'
UNION ALL SELECT 'inv_fx_rates', COUNT(*) FROM information_schema.tables WHERE table_name = 'inv_fx_rates';

SELECT 'inv_shipments new columns:' AS status;
SELECT column_name FROM information_schema.columns
WHERE table_name = 'inv_shipments'
  AND column_name IN ('total_landed_cost_usd', 'total_landed_cost_egp', 'allocation_method', 'fx_usd_to_egp', 'fx_source', 'fx_locked_at', 'cost_finalized_at', 'cost_finalized_by');

SELECT 'invoice_items new columns:' AS status;
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoice_items'
  AND column_name IN ('inv_sku_id', 'inv_warehouse_id', 'cogs_usd', 'cogs_egp', 'cogs_movement_id');
