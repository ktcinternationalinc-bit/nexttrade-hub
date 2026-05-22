-- v55.83-A.6.27.38 — Catalog support: featured/use_count + drop quick_code UNIQUE + Pattern parent rules
--
-- Run this AFTER the v55.83-A.6.27.37b shipment-headers migration is in place.
-- Idempotent — safe to re-run.

-- ─── 1. Fix Level CHECK constraint (was 1-8, needs 1-9) ──────────
ALTER TABLE inventory_lists DROP CONSTRAINT IF EXISTS inventory_lists_level_check;
ALTER TABLE inventory_lists ADD CONSTRAINT inventory_lists_level_check
  CHECK (level BETWEEN 1 AND 9);

-- ─── 2. Add Level 9 (Origin Country) — USA only ──────────────────
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (9, 'US', 'United States', 'الولايات المتحدة', 1)
ON CONFLICT DO NOTHING;
UPDATE inventory_lists SET active = true WHERE level = 9 AND code = 'US';

-- ─── 3. Add featured + use_count columns to inventory_products ───
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS use_count integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inv_products_featured  ON inventory_products (featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_inv_products_use_count ON inventory_products (use_count DESC);

-- ─── 4. Drop UNIQUE constraint on quick_code ─────────────────────
-- quick_code is now a search shortcut, not a unique identifier. Multiple master
-- rows can share the same quick_code (e.g. LLBKUS) but differ in construction/
-- backing/pattern. The unique identifier is classification_slug.
DROP INDEX IF EXISTS idx_inv_products_quick_code_active;
CREATE INDEX IF NOT EXISTS idx_inv_products_quick_code ON inventory_products (lower(quick_code)) WHERE quick_code IS NOT NULL;

-- ─── 5. Auto-increment use_count on receipt + (future) invoice ──
CREATE OR REPLACE FUNCTION increment_product_use_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE inventory_products
    SET use_count = COALESCE(use_count, 0) + 1
    WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_increment_use_count_on_receipt ON inventory_stock_receipts;
CREATE TRIGGER trigger_increment_use_count_on_receipt
AFTER INSERT ON inventory_stock_receipts
FOR EACH ROW EXECUTE FUNCTION increment_product_use_count();

-- ─── 6. Fix Leather Pattern parent rules (add missing MG, RG, NA → L) ──
INSERT INTO inventory_list_rules (child_list_id, parent_list_id)
SELECT c.id, p.id
FROM inventory_lists c, inventory_lists p
WHERE c.level = 7 AND c.code IN ('MG','RG','NA')
  AND p.level = 1 AND p.code = 'L'
ON CONFLICT DO NOTHING;

-- ─── 7. Refresh classification_slug for any existing products ────
UPDATE inventory_products p
SET classification_slug = COALESCE((SELECT code FROM inventory_lists WHERE id = p.family_list_id), '')
  || '-' || COALESCE((SELECT code FROM inventory_lists WHERE id = p.category_list_id), '')
  || '-' || COALESCE((SELECT code FROM inventory_lists WHERE id = p.grade_list_id), '')
  || '-' || COALESCE((SELECT code FROM inventory_lists WHERE id = p.construction_list_id), '')
  || '-' || COALESCE((SELECT code FROM inventory_lists WHERE id = p.backing_list_id), '')
  || '-' || COALESCE((SELECT code FROM inventory_lists WHERE id = p.color_list_id), '')
  || '-' || COALESCE((SELECT code FROM inventory_lists WHERE id = p.pattern_list_id), '')
  || '-' || COALESCE((SELECT code FROM inventory_lists WHERE id = p.spec_class_list_id), '')
WHERE p.family_list_id IS NOT NULL;

-- ─── Verification ────────────────────────────────────────────────
-- SELECT level, code, label_en FROM inventory_lists WHERE level = 9 ORDER BY display_order;  -- US
-- SELECT column_name FROM information_schema.columns WHERE table_name='inventory_products' AND column_name IN ('featured','use_count');
-- SELECT c.code FROM inventory_list_rules r JOIN inventory_lists c ON c.id=r.child_list_id JOIN inventory_lists p ON p.id=r.parent_list_id WHERE c.level=7 AND p.code='L';  -- expect HC, MG, RG, NA
