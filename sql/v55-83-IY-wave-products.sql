-- v55.83-IY — per-line Wave PRODUCT selection on invoices (Codex/Max P0).
--
-- Staff must pick the real Wave-recognized product per invoice LINE (not one default for the whole
-- invoice). This adds: (1) a per-silo Wave product catalog the Hub can list without leaving the app,
-- (2) durable per-line Wave product id/name on invoice + proforma items.

-- 1. Cached Wave product catalog, scoped per silo (read-only mirror; pulled via /api/wave/sync-products).
CREATE TABLE IF NOT EXISTS wave_products (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  wave_business_id  text NOT NULL,
  wave_product_id   text NOT NULL,
  name              text,
  description       text,
  is_sold           boolean,
  is_archived       boolean,
  last_synced_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wave_products_biz_product
  ON wave_products (wave_business_id, wave_product_id);
CREATE INDEX IF NOT EXISTS idx_wave_products_biz ON wave_products (wave_business_id);

DO $$ BEGIN ALTER TABLE wave_products ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS wp_sel ON wave_products;
  DROP POLICY IF EXISTS wp_ins ON wave_products;
  DROP POLICY IF EXISTS wp_upd ON wave_products;
  DROP POLICY IF EXISTS wp_del ON wave_products;
  CREATE POLICY wp_sel ON wave_products FOR SELECT TO authenticated USING (true);
  CREATE POLICY wp_ins ON wave_products FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY wp_upd ON wave_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY wp_del ON wave_products FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN others THEN NULL; END $$;

-- 2. Per-line Wave product on invoice + proforma items (description stays the customer-facing text).
ALTER TABLE accounting_invoice_items  ADD COLUMN IF NOT EXISTS wave_product_id    text;
ALTER TABLE accounting_invoice_items  ADD COLUMN IF NOT EXISTS wave_product_name  text;
ALTER TABLE accounting_invoice_items  ADD COLUMN IF NOT EXISTS wave_product_source text; -- 'selected' | 'default_fallback' | 'imported'
ALTER TABLE accounting_proforma_items ADD COLUMN IF NOT EXISTS wave_product_id    text;
ALTER TABLE accounting_proforma_items ADD COLUMN IF NOT EXISTS wave_product_name  text;

-- VERIFY:
-- SELECT count(*) FROM wave_products WHERE wave_business_id = '<KTC wave id>';  -- after a product pull
-- SELECT column_name FROM information_schema.columns WHERE table_name='accounting_invoice_items' AND column_name LIKE 'wave_product%';
