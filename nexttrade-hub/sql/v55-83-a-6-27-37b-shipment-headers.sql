-- v55.83-A.6.27.37 — Shipment header table + simpler origin list
--
-- Adds a parent inventory_shipment_headers table so a shipment can be saved
-- with JUST the shipping info before any products are added. Each receipt line
-- in inventory_stock_receipts links to a header by header_id. Lines without a
-- header keep working (backward compat).

-- ─── 1. New table: inventory_shipment_headers (shell shipments) ──
CREATE TABLE IF NOT EXISTS inventory_shipment_headers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number           text NOT NULL UNIQUE,
  receipt_date             date NOT NULL DEFAULT CURRENT_DATE,
  status                   text NOT NULL DEFAULT 'pending_detail',

  -- Shipment info
  shipment_reference       text,
  supplier                 text,
  warehouse_id             uuid REFERENCES inv_warehouses(id) ON DELETE RESTRICT,
  freight_forwarder        text,
  shipping_line            text,
  container_number         text,
  eta_date                 date,
  arrival_date             date,
  purchase_currency        text DEFAULT 'USD',
  origin_country_code      text,    -- US / CA / CN
  notes                    text,

  -- Audit
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  cancelled_at             timestamptz,
  cancelled_by             uuid,
  cancel_reason            text,

  CONSTRAINT chk_sh_status            CHECK (status IN ('pending_detail','received','finalized','cancelled')),
  CONSTRAINT chk_sh_purchase_currency CHECK (purchase_currency IS NULL OR purchase_currency IN ('EGP','USD','EUR'))
);

CREATE INDEX IF NOT EXISTS idx_shipment_headers_date      ON inventory_shipment_headers (receipt_date);
CREATE INDEX IF NOT EXISTS idx_shipment_headers_status    ON inventory_shipment_headers (status);
CREATE INDEX IF NOT EXISTS idx_shipment_headers_warehouse ON inventory_shipment_headers (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_shipment_headers_ref       ON inventory_shipment_headers (shipment_reference) WHERE shipment_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION update_shipment_headers_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_shipment_headers_updated_at ON inventory_shipment_headers;
CREATE TRIGGER trigger_shipment_headers_updated_at
BEFORE UPDATE ON inventory_shipment_headers
FOR EACH ROW EXECUTE FUNCTION update_shipment_headers_updated_at();

ALTER TABLE inventory_shipment_headers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_sh_read  ON inventory_shipment_headers;
CREATE POLICY inv_sh_read  ON inventory_shipment_headers FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_sh_write ON inventory_shipment_headers;
CREATE POLICY inv_sh_write ON inventory_shipment_headers FOR ALL USING (true) WITH CHECK (true);

-- ─── 2. Link inventory_stock_receipts to header (optional FK) ────
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS header_id uuid REFERENCES inventory_shipment_headers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_stock_receipts_header ON inventory_stock_receipts (header_id) WHERE header_id IS NOT NULL;

-- ─── 3. Backfill headers from existing receipts (for prior receipts) ──
-- For each distinct receipt_number that already has lines but no header,
-- create a header from the first line's shipment info.
DO $$
DECLARE
  r RECORD;
  v_header_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (receipt_number)
      receipt_number, receipt_date, status, shipment_reference, supplier,
      warehouse_id, freight_forwarder, shipping_line, container_number,
      eta_date, arrival_date, purchase_currency, notes
    FROM inventory_stock_receipts
    WHERE header_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM inventory_shipment_headers h WHERE h.receipt_number = inventory_stock_receipts.receipt_number)
    ORDER BY receipt_number, created_at ASC
  LOOP
    INSERT INTO inventory_shipment_headers (
      receipt_number, receipt_date,
      status,
      shipment_reference, supplier, warehouse_id,
      freight_forwarder, shipping_line, container_number,
      eta_date, arrival_date, purchase_currency, notes
    ) VALUES (
      r.receipt_number, r.receipt_date,
      CASE WHEN r.status IN ('pending_detail','received','finalized','cancelled') THEN r.status ELSE 'received' END,
      r.shipment_reference, r.supplier, r.warehouse_id,
      r.freight_forwarder, r.shipping_line, r.container_number,
      r.eta_date, r.arrival_date, COALESCE(r.purchase_currency, 'USD'), r.notes
    ) RETURNING id INTO v_header_id;

    UPDATE inventory_stock_receipts SET header_id = v_header_id
    WHERE receipt_number = r.receipt_number AND header_id IS NULL;
  END LOOP;
END $$;

-- ─── 4. Trim origin country list to just 3 (US / CA / CN) ────────
-- First, soft-disable any existing Level 9 rows that aren't the 3 we want.
UPDATE inventory_lists SET active = false
WHERE level = 9 AND code NOT IN ('US','CA','CN');

-- Then make sure the 3 we want exist and are active.
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (9, 'US', 'United States', 'الولايات المتحدة', 1),
  (9, 'CA', 'Canada',        'كندا',             2),
  (9, 'CN', 'China',          'الصين',           3)
ON CONFLICT DO NOTHING;

-- Reactivate any of the 3 that might have been soft-disabled previously
UPDATE inventory_lists SET active = true
WHERE level = 9 AND code IN ('US','CA','CN');

-- ─── Verify ──────────────────────────────────────────────────────
-- SELECT level, code, label_en, active FROM inventory_lists WHERE level = 9 ORDER BY display_order;
-- Expect: US/CA/CN active=true, others (CN/KR/TR/IT/EG/DE/JP/VN/IN/BR/MX from prior 37) inactive
-- SELECT COUNT(*) AS headers FROM inventory_shipment_headers;
-- Expect: equals the number of distinct receipt_numbers from any prior receipts you had
