-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-OO — PRODUCT COSTS with EFFECTIVE DATES (the P&L foundation)
-- Each row = "this product costs X per unit FROM this date onward". Changing a
-- cost means adding a NEW row with a new effective_from — history is never
-- overwritten, so every invoice is costed with the price that was true on its
-- own invoice date (exactly as Max specified).
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_costs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key    text NOT NULL,            -- normalized product name (lowercase, single-spaced)
  product_label  text,                     -- the name as humans see it
  cost_per_unit  numeric NOT NULL,
  effective_from date NOT NULL,
  currency       text NOT NULL DEFAULT 'USD',
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_key, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_product_costs_key_date ON product_costs (product_key, effective_from DESC);
ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "product_costs_select" ON product_costs FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "product_costs_insert" ON product_costs FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "product_costs_update" ON product_costs FOR UPDATE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "product_costs_delete" ON product_costs FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- VERIFICATION — expect ✅ and policies: 4
SELECT 'product_costs table + RLS' AS check_name,
       CASE WHEN to_regclass('public.product_costs') IS NULL THEN '❌ MISSING'
            ELSE '✅ exists, policies: ' || (SELECT COUNT(*)::text FROM pg_policies WHERE tablename='product_costs') END AS result;
