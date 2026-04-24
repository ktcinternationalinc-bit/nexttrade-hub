-- S19 (Apr 23 2026) — Inventory expected-vs-actual tracking.
--
-- Stores "what we expected to receive" per product + shipment. Completely
-- separate from the live inventory and inventory_inbounds tables so
-- entering an expected quantity NEVER changes actual stock values.
--
-- Safe to run multiple times — idempotent.

CREATE TABLE IF NOT EXISTS inventory_expected (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id TEXT NOT NULL,
  shipment_reference TEXT NOT NULL,
  expected_quantity NUMERIC NOT NULL DEFAULT 0,
  expected_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_expected_product_id ON inventory_expected(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expected_shipment_reference ON inventory_expected(shipment_reference);

-- RLS: let the app (service role) read/write freely for now. If Max wants
-- tighter per-user rules later we can add policies.
DO $$
BEGIN
  ALTER TABLE inventory_expected ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Allow all on inventory_expected" ON inventory_expected
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN others THEN NULL;
END $$;

-- Sanity check
SELECT 'inventory_expected ready' AS status, count(*) AS row_count FROM inventory_expected;
