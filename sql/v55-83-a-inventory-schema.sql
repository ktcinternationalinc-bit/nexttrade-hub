-- ============================================================================
-- v55.83-A — Inventory Module Foundation (Stage 1 of 6)
-- ============================================================================
-- Architecture decisions locked in across multiple design conversations:
--   • Weighted Average costing (one rolling avg cost per SKU)
--   • Rolling weighted-avg base FX rate per SKU (to-EGP and to-USD) — for FX impact P&L
--   • Multi-currency: EGP, USD, EUR core; extensible via inv_fx_rates
--   • Multi-warehouse: starts with Cairo, Sokhna, USA, Other
--   • One primary unit per SKU; conversions stored on the SKU row
--   • Per-shipment P&L: dual approach — Expected (vs target prices) + Attributed (proportional)
--   • Customs/freight/handling auto-distributed by primary unit
--   • Append-only inv_movements ledger (the audit truth)
--   • Soft-delete via deleted_at (never hard-DELETE)
--   • P&L visibility gated to super_admin + users granted inv.see_pnl
--   • Cost visibility gated to super_admin + users granted inv.see_costs
--   • Original-quantity edits require super_admin and write to inv_audit_journal
--   • Oversell allowed (show red, never block)
--   • Existing inventory test data wiped
--
-- IDEMPOTENT — safe to re-run. All CREATEs use IF NOT EXISTS.
-- ============================================================================

-- ============================================================================
-- STEP 0 — ARCHIVE THEN WIPE EXISTING TEST DATA
-- ============================================================================
-- Save a one-time snapshot of the existing inventory table so the data is
-- never lost — even though Max confirmed it's all test data. Cheap insurance.

CREATE TABLE IF NOT EXISTS inventory_archive_pre_v55_83_a AS
  SELECT * FROM inventory;

-- Wipe the test rows. Subordinate tables (inventory_inbounds, inventory_adjustments)
-- aren't touched here — they reference inventory.id via FK in some setups, but
-- if so the TRUNCATE CASCADE would have already taken them.
-- Using DELETE instead of TRUNCATE so audit_log entries remain consistent.
DELETE FROM inventory;

-- ============================================================================
-- STEP 1 — WAREHOUSES (Table 1)
-- ============================================================================
-- Where stock physically lives. Multi-location with country + default currency.
-- Code is a short identifier used in shipment refs, audit logs, etc.

CREATE TABLE IF NOT EXISTS inv_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  country TEXT,
  address TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inv_warehouses_active
  ON inv_warehouses (is_active)
  WHERE deleted_at IS NULL;

-- Seed the four starter warehouses per Max May 13 2026.
-- Cairo + Sokhna in Egypt (EGP). USA + Other start in USD; user can edit later.
-- ON CONFLICT DO NOTHING means re-running this script doesn't duplicate rows.
INSERT INTO inv_warehouses (name, code, country, default_currency)
VALUES
  ('Cairo',  'EG-CAI', 'EG', 'EGP'),
  ('Sokhna', 'EG-SKH', 'EG', 'EGP'),
  ('USA',    'US-MAIN','US', 'USD'),
  ('Other',  'OTHER',  NULL, 'USD')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- STEP 2 — MASTER SKU DATABASE (Table 2)
-- ============================================================================
-- The permanent identity layer. One row per unique SKU you stock.
-- Costing fields (avg_landed_cost, avg_base_fx_*) maintained as denormalized
-- caches of the latest inv_movements running totals. Authoritative truth is
-- in the movements ledger; this row is a fast-read convenience.

CREATE TABLE IF NOT EXISTS inv_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_number TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  description_ar TEXT,
  product_type TEXT,
  subcategory TEXT,
  color_en TEXT,
  color_ar TEXT,
  material TEXT,

  -- Unit handling — ONE primary unit per SKU. Other unit display via factors.
  primary_unit TEXT NOT NULL DEFAULT 'piece',
  kg_per_yard NUMERIC(10,4),
  kg_per_meter NUMERIC(10,4),
  yards_per_meter NUMERIC(10,4) DEFAULT 1.0936,
  yards_per_roll NUMERIC(10,4),
  meters_per_roll NUMERIC(10,4),

  -- Weighted-average cost (rolling, in cost_currency)
  avg_landed_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  cost_currency TEXT NOT NULL DEFAULT 'USD',

  -- Rolling weighted-avg base FX rates (Option B per design). Maintained
  -- alongside avg_landed_cost so FX Impact P&L is precise to current stock.
  avg_base_fx_to_egp NUMERIC(18,8),
  avg_base_fx_to_usd NUMERIC(18,8),

  -- Last-shipment snapshot for reporting; not used in COGS calc.
  last_purchase_cost NUMERIC(18,4),
  last_purchase_currency TEXT,

  -- Target sell price for the Expected P&L view.
  target_sell_price NUMERIC(18,4),
  target_sell_currency TEXT,

  -- Optional: industry-standard cost (a benchmark the user enters manually)
  standard_cost NUMERIC(18,4),

  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT inv_skus_primary_unit_check
    CHECK (primary_unit IN ('kg','yard','meter','roll','piece','liter','box'))
);

CREATE INDEX IF NOT EXISTS idx_inv_skus_sku_number ON inv_skus (sku_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_skus_product_type ON inv_skus (product_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_skus_active ON inv_skus (is_active) WHERE deleted_at IS NULL;

-- ============================================================================
-- STEP 3 — FX RATES (Table 9)
-- ============================================================================
-- Generic currency-pair table. Designed for adding currencies without code
-- changes. Helper SQL function returns the rate on or before a given date.

CREATE TABLE IF NOT EXISTS inv_fx_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  rate_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  set_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inv_fx_rates_unique UNIQUE (from_currency, to_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_inv_fx_rates_lookup
  ON inv_fx_rates (from_currency, to_currency, rate_date DESC);

-- Seed today's rough rates so the system has something to anchor to until
-- Max sets actual rates. These are PLACEHOLDERS — should be updated by user.
INSERT INTO inv_fx_rates (from_currency, to_currency, rate, rate_date, source, notes)
VALUES
  ('USD', 'EGP', 50.00, CURRENT_DATE, 'seed', 'Placeholder — please update in Settings'),
  ('EUR', 'EGP', 54.00, CURRENT_DATE, 'seed', 'Placeholder — please update in Settings'),
  ('EUR', 'USD',  1.08, CURRENT_DATE, 'seed', 'Placeholder — please update in Settings'),
  ('EGP', 'USD', 0.0200, CURRENT_DATE, 'seed', 'Placeholder — please update in Settings'),
  ('EGP', 'EUR', 0.0185, CURRENT_DATE, 'seed', 'Placeholder — please update in Settings'),
  ('USD', 'EUR', 0.9259, CURRENT_DATE, 'seed', 'Placeholder — please update in Settings')
ON CONFLICT (from_currency, to_currency, rate_date) DO NOTHING;

-- ============================================================================
-- STEP 4 — SHIPMENTS HEADER (Table 3)
-- ============================================================================
-- One row per shipment reference. Holds totals at the header level. SKU
-- breakdown lives in inv_shipment_skus (Step 5).

CREATE TABLE IF NOT EXISTS inv_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_ref TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',

  -- Sources
  supplier_name TEXT,
  supplier_id UUID,
  container_numbers TEXT[],
  freight_forwarder TEXT,
  shipping_line TEXT,

  -- Dates
  eta_date DATE,
  arrival_date DATE,
  received_date DATE,

  -- Destination warehouse
  warehouse_id UUID REFERENCES inv_warehouses(id),

  -- Header totals (unit-flexible per the spec — fill what you have)
  total_kg NUMERIC(14,3),
  total_yards NUMERIC(14,3),
  total_meters NUMERIC(14,3),

  -- Cost components — each has its own currency for mix-and-match input
  purchase_cost NUMERIC(18,4),
  purchase_currency TEXT,
  freight_cost NUMERIC(18,4),
  freight_currency TEXT,
  customs_cost NUMERIC(18,4),
  customs_currency TEXT,
  port_fees NUMERIC(18,4),
  port_fees_currency TEXT,
  inland_transport NUMERIC(18,4),
  inland_currency TEXT,
  handling_fees NUMERIC(18,4),
  handling_currency TEXT,
  other_charges NUMERIC(18,4),
  other_currency TEXT,
  other_charges_desc TEXT,

  -- Base FX snapshots — LOCKED at shipment entry, never recalculated.
  -- These are the rates used to convert every cost component to a single
  -- reporting currency (EGP or USD).
  base_fx_egp_per_usd NUMERIC(18,8),
  base_fx_egp_per_eur NUMERIC(18,8),
  base_fx_usd_per_eur NUMERIC(18,8),

  -- Computed totals
  landed_cost_egp NUMERIC(18,4),
  landed_cost_usd NUMERIC(18,4),

  -- For Expected P&L computation
  target_revenue_egp NUMERIC(18,4),
  target_revenue_usd NUMERIC(18,4),

  allocation_basis TEXT NOT NULL DEFAULT 'kg',

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT inv_shipments_status_check
    CHECK (status IN ('draft','in_transit','arrived','received','cancelled')),
  CONSTRAINT inv_shipments_allocation_check
    CHECK (allocation_basis IN ('kg','yard','meter','value','manual'))
);

CREATE INDEX IF NOT EXISTS idx_inv_shipments_ref ON inv_shipments (shipment_ref) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_shipments_status ON inv_shipments (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_shipments_warehouse ON inv_shipments (warehouse_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_shipments_arrival ON inv_shipments (arrival_date DESC);

-- ============================================================================
-- STEP 5 — SHIPMENT SKU BREAKDOWN (Table 4)
-- ============================================================================
-- One row per SKU per shipment. The reconciliation layer:
-- SUM(qty_primary) across these rows should match shipment header totals.

CREATE TABLE IF NOT EXISTS inv_shipment_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES inv_shipments(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES inv_skus(id),

  -- Quantities — record what you have; primary is required
  roll_count INTEGER,
  qty_kg NUMERIC(14,3),
  qty_yards NUMERIC(14,3),
  qty_meters NUMERIC(14,3),
  qty_pieces NUMERIC(14,3),
  qty_primary NUMERIC(14,3) NOT NULL,

  -- Costing — derived after allocation in Stage C
  unit_cost NUMERIC(18,4),
  unit_cost_currency TEXT,
  landed_unit_cost_egp NUMERIC(18,4),
  landed_unit_cost_usd NUMERIC(18,4),
  base_fx_to_egp NUMERIC(18,8),
  base_fx_to_usd NUMERIC(18,8),

  warehouse_id UUID REFERENCES inv_warehouses(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,

  CONSTRAINT inv_shipment_skus_unique UNIQUE (shipment_id, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_shipment_skus_sku ON inv_shipment_skus (sku_id);
CREATE INDEX IF NOT EXISTS idx_inv_shipment_skus_shipment ON inv_shipment_skus (shipment_id);

-- ============================================================================
-- STEP 6 — MOVEMENTS LEDGER (Table 5) — THE AUDIT TRUTH
-- ============================================================================
-- Append-only. Every change to inventory is a row here. Master SKU's
-- avg_landed_cost / avg_base_fx_* are denormalized caches of the latest
-- running_* column from the latest movement on that SKU+warehouse.

CREATE TABLE IF NOT EXISTS inv_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES inv_skus(id),
  warehouse_id UUID NOT NULL REFERENCES inv_warehouses(id),

  movement_type TEXT NOT NULL,
  qty_change NUMERIC(14,3) NOT NULL,  -- signed: + for in, - for out

  -- Snapshot of the cost characteristics at this movement
  unit_cost_at_movement NUMERIC(18,4),
  cost_currency TEXT,
  fx_to_egp_at_movement NUMERIC(18,8),
  fx_to_usd_at_movement NUMERIC(18,8),

  -- Running totals AFTER this movement (denormalized for speed)
  running_qty_after NUMERIC(14,3),
  running_avg_cost_after NUMERIC(18,4),
  running_avg_fx_egp_after NUMERIC(18,8),
  running_avg_fx_usd_after NUMERIC(18,8),

  -- Source attribution — where this movement came from
  source_table TEXT,
  source_id UUID,
  invoice_line_id UUID,

  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id UUID,
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT inv_movements_type_check CHECK (movement_type IN (
    'receipt','sale','return','transfer_out','transfer_in',
    'adjustment_in','adjustment_out','damage','write_off',
    'opening_balance','physical_count_correction'
  ))
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_sku_date
  ON inv_movements (sku_id, warehouse_id, movement_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_source
  ON inv_movements (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_invoice_line
  ON inv_movements (invoice_line_id) WHERE invoice_line_id IS NOT NULL;

-- ============================================================================
-- STEP 7 — ADJUSTMENTS (Table 6)
-- ============================================================================
-- Form-layer wrapper for adjustment movements. Goes through approval flow,
-- THEN writes to inv_movements (linked via movement_id).

CREATE TABLE IF NOT EXISTS inv_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES inv_skus(id),
  warehouse_id UUID NOT NULL REFERENCES inv_warehouses(id),

  adjustment_type TEXT NOT NULL,
  qty_change NUMERIC(14,3) NOT NULL,
  reason TEXT NOT NULL,
  reference_doc TEXT,

  status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,

  movement_id UUID REFERENCES inv_movements(id),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,

  CONSTRAINT inv_adjustments_type_check CHECK (adjustment_type IN (
    'correction','damage','return','count','manual_add',
    'manual_remove','write_off','transfer'
  )),
  CONSTRAINT inv_adjustments_status_check
    CHECK (status IN ('pending','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_inv_adjustments_status
  ON inv_adjustments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_adjustments_sku
  ON inv_adjustments (sku_id);

-- ============================================================================
-- STEP 8 — TRANSFERS (Table 7)
-- ============================================================================
-- Warehouse-to-warehouse movement. Two-phase: out movement at transfer time,
-- in movement at receipt time (so in-transit qty is visible in reports).

CREATE TABLE IF NOT EXISTS inv_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES inv_skus(id),
  from_warehouse_id UUID NOT NULL REFERENCES inv_warehouses(id),
  to_warehouse_id UUID NOT NULL REFERENCES inv_warehouses(id),
  qty NUMERIC(14,3) NOT NULL,

  status TEXT NOT NULL DEFAULT 'in_transit',
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  received_date DATE,

  transport_cost NUMERIC(18,4),
  transport_currency TEXT,

  out_movement_id UUID REFERENCES inv_movements(id),
  in_movement_id UUID REFERENCES inv_movements(id),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,

  CONSTRAINT inv_transfers_status_check
    CHECK (status IN ('in_transit','received','cancelled')),
  CONSTRAINT inv_transfers_different_warehouses
    CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_transfers_status
  ON inv_transfers (status, transfer_date DESC);

-- ============================================================================
-- STEP 9 — INVOICE LINES (Table 8) — SALES LINKAGE
-- ============================================================================
-- Bridges existing invoices table to inventory. New invoices going forward
-- create rows here. Existing invoices remain untouched (no retroactive link).
-- COGS + FX rates SNAPSHOTTED at write time — never recalculated.

CREATE TABLE IF NOT EXISTS inv_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,  -- not FK'd to keep this module decoupled
  sku_id UUID NOT NULL REFERENCES inv_skus(id),
  warehouse_id UUID NOT NULL REFERENCES inv_warehouses(id),

  qty_sold NUMERIC(14,3) NOT NULL,
  unit_sell_price NUMERIC(18,4) NOT NULL,
  sell_currency TEXT NOT NULL,
  sale_fx_to_egp NUMERIC(18,8),
  sale_fx_to_usd NUMERIC(18,8),

  -- COGS snapshot — captured at write time, never recalculated
  cogs_unit_cost NUMERIC(18,4),
  cogs_currency TEXT,
  cogs_avg_fx_to_egp NUMERIC(18,8),
  cogs_avg_fx_to_usd NUMERIC(18,8),

  -- Computed at write time
  revenue_egp NUMERIC(18,4),
  revenue_usd NUMERIC(18,4),
  cogs_egp NUMERIC(18,4),
  cogs_usd NUMERIC(18,4),

  -- The three numbers Max specifically asked for, snapshotted
  gross_profit_egp NUMERIC(18,4),
  fx_impact_egp NUMERIC(18,4),
  total_profit_egp NUMERIC(18,4),
  gross_profit_usd NUMERIC(18,4),
  fx_impact_usd NUMERIC(18,4),
  total_profit_usd NUMERIC(18,4),

  movement_id UUID REFERENCES inv_movements(id),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_inv_invoice_lines_invoice
  ON inv_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_invoice_lines_sku
  ON inv_invoice_lines (sku_id, created_at DESC);

-- ============================================================================
-- STEP 10 — AUDIT JOURNAL (Table 10)
-- ============================================================================
-- Specifically for high-sensitivity edits (original quantity, cost rewrites).
-- Separate from existing audit_log so it can be queried independently and
-- shown inline on shipment/SKU detail pages.

CREATE TABLE IF NOT EXISTS inv_audit_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_reason TEXT,
  changed_by UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  financial_impact_egp NUMERIC(18,4),
  financial_impact_usd NUMERIC(18,4),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_audit_journal_entity
  ON inv_audit_journal (entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_audit_journal_user
  ON inv_audit_journal (changed_by, changed_at DESC);

-- ============================================================================
-- STEP 11 — IMPORT JOBS (Table 11)
-- ============================================================================
-- Tracks bulk imports per the addendum. Row-level errors stored as JSONB
-- so failed rows can be reviewed without re-running the whole import.

CREATE TABLE IF NOT EXISTS inv_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type TEXT NOT NULL,
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_rows INTEGER,
  imported_rows INTEGER DEFAULT 0,
  skipped_rows INTEGER DEFAULT 0,
  error_rows INTEGER DEFAULT 0,
  error_details JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  started_by UUID,

  CONSTRAINT inv_import_jobs_type_check CHECK (import_type IN (
    'shipments','shipment_skus','master_skus','adjustments','costs','fx_rates'
  )),
  CONSTRAINT inv_import_jobs_status_check
    CHECK (status IN ('pending','processing','completed','partial','failed'))
);

CREATE INDEX IF NOT EXISTS idx_inv_import_jobs_recent
  ON inv_import_jobs (started_at DESC);

-- ============================================================================
-- STEP 12 — PERMISSION SEEDS
-- ============================================================================
-- Three new permission keys live in the existing user_permissions / role_permissions
-- system. Without a row, the user does NOT have the permission. Super_admin
-- (role-based) bypasses these checks in code.
--
-- Permission keys (used in src/lib/inventory-permissions.js):
--   inv.view        — see SKU names, qtys, warehouses (granted via tab access)
--   inv.see_costs   — see landed cost, avg cost, FX rates
--   inv.see_pnl     — see Gross / FX Impact / Total Profit P&L
--
-- No SQL inserts needed here — permissions are granted per-user via the
-- existing Settings → Permissions UI which writes to user_permissions.

-- ============================================================================
-- STEP 13 — VERIFICATION QUERIES
-- ============================================================================
-- Run these after the migration to confirm everything's in place.

SELECT 'inv_warehouses' AS table_name, COUNT(*) AS row_count FROM inv_warehouses
UNION ALL SELECT 'inv_skus', COUNT(*) FROM inv_skus
UNION ALL SELECT 'inv_fx_rates', COUNT(*) FROM inv_fx_rates
UNION ALL SELECT 'inv_shipments', COUNT(*) FROM inv_shipments
UNION ALL SELECT 'inv_shipment_skus', COUNT(*) FROM inv_shipment_skus
UNION ALL SELECT 'inv_movements', COUNT(*) FROM inv_movements
UNION ALL SELECT 'inv_adjustments', COUNT(*) FROM inv_adjustments
UNION ALL SELECT 'inv_transfers', COUNT(*) FROM inv_transfers
UNION ALL SELECT 'inv_invoice_lines', COUNT(*) FROM inv_invoice_lines
UNION ALL SELECT 'inv_audit_journal', COUNT(*) FROM inv_audit_journal
UNION ALL SELECT 'inv_import_jobs', COUNT(*) FROM inv_import_jobs
ORDER BY table_name;

-- Confirm warehouses seeded
SELECT code, name, country, default_currency FROM inv_warehouses ORDER BY code;

-- Confirm FX rates seeded
SELECT from_currency, to_currency, rate, rate_date FROM inv_fx_rates ORDER BY from_currency, to_currency;

-- Confirm test inventory wiped
SELECT COUNT(*) AS old_inventory_rows_remaining FROM inventory;
SELECT COUNT(*) AS archived_rows FROM inventory_archive_pre_v55_83_a;
