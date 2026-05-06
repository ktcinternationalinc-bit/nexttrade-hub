-- S20 (Apr 23 2026) — Journal log for super-admin manual adjustments to
-- inventory quantities. Keeps an immutable audit trail whenever someone
-- bypasses the normal "add inbound → auto-update current" flow and
-- directly overwrites Original Quantity or Current Quantity.
--
-- Every row answers: who changed what, when, from what, to what, and why.
-- Viewable inside the Product Detail modal so a full history travels with
-- the product_id forever.
--
-- Safe to run multiple times — idempotent.

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id TEXT NOT NULL,
  field TEXT NOT NULL,               -- 'original_quantity' or 'current_quantity'
  old_value NUMERIC,
  new_value NUMERIC,
  delta NUMERIC GENERATED ALWAYS AS (COALESCE(new_value, 0) - COALESCE(old_value, 0)) STORED,
  reason TEXT,                       -- free-form explanation the user typed
  source TEXT,                       -- 'manual' | 'import' — where the adjustment came from
  adjusted_by UUID,                  -- user id of the super-admin
  adjusted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_product_id ON inventory_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_adjusted_at ON inventory_adjustments(adjusted_at DESC);

DO $$
BEGIN
  ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Allow all on inventory_adjustments" ON inventory_adjustments
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT 'inventory_adjustments ready' AS status, count(*) AS row_count FROM inventory_adjustments;
