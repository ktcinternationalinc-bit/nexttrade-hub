-- v55.83-A.6.27.37 — Inventory Phase 1 Build 5: Classification refresh
--
-- Three changes:
--   1. Rename Family codes from 1-letter to 2-letter (L→LE, T→TX, P→PV, B→BD)
--   2. Add Dark Grey color (DG) which was missing
--   3. Add Level 9 "Origin Country" with 12 country codes
--
-- Existing classification_slug values on inventory_products will be invalidated by
-- the family rename — a small refresh function regenerates them safely at the end.

-- ─── 1. Rename Family codes (L→LE, T→TX, P→PV, B→BD) ────────────
-- Use UPDATE because the existing rows are referenced by inventory_products FKs.
-- The UNIQUE INDEX is on (level, lower(code)) where active=true, so we update in place.
UPDATE inventory_lists SET code = 'LE' WHERE level = 1 AND code = 'L'  AND active = true;
UPDATE inventory_lists SET code = 'TX' WHERE level = 1 AND code = 'T'  AND active = true;
UPDATE inventory_lists SET code = 'PV' WHERE level = 1 AND code = 'P'  AND active = true;
UPDATE inventory_lists SET code = 'BD' WHERE level = 1 AND code = 'B'  AND active = true;

-- ─── 2. Add Dark Grey color (was missing) ────────────────────────
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (6, 'DG', 'Dark Grey', 'رمادي غامق', 12)
ON CONFLICT DO NOTHING;

-- ─── 3. Add Level 9: Origin Country ─────────────────────────────
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (9, 'US', 'United States', 'الولايات المتحدة', 1),
  (9, 'CN', 'China',         'الصين',           2),
  (9, 'KR', 'South Korea',   'كوريا الجنوبية',  3),
  (9, 'TR', 'Turkey',        'تركيا',           4),
  (9, 'IT', 'Italy',         'إيطاليا',         5),
  (9, 'EG', 'Egypt',         'مصر',             6),
  (9, 'DE', 'Germany',       'ألمانيا',         7),
  (9, 'JP', 'Japan',         'اليابان',         8),
  (9, 'VN', 'Vietnam',       'فيتنام',          9),
  (9, 'IN', 'India',         'الهند',          10),
  (9, 'BR', 'Brazil',        'البرازيل',       11),
  (9, 'MX', 'Mexico',        'المكسيك',        12)
ON CONFLICT DO NOTHING;

-- ─── 4. Schema: add origin_list_id column to inventory_products ──
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS origin_list_id uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_inv_products_origin ON inventory_products (origin_list_id);

-- ─── 5. Refresh classification_slug on any existing inventory_products ──
-- This rebuilds slugs that referenced the old 1-letter family codes (e.g. "L-SM-LX-...")
-- with the new 2-letter family codes (e.g. "LE-SM-LX-..."). Idempotent — safe to re-run.
UPDATE inventory_products p
SET classification_slug = COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.family_list_id), ''
) || '-' || COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.category_list_id), ''
) || '-' || COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.grade_list_id), ''
) || '-' || COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.construction_list_id), ''
) || '-' || COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.backing_list_id), ''
) || '-' || COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.color_list_id), ''
) || '-' || COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.pattern_list_id), ''
) || '-' || COALESCE(
  (SELECT code FROM inventory_lists WHERE id = p.spec_class_list_id), ''
)
WHERE p.family_list_id IS NOT NULL;

-- ─── Verify ───────────────────────────────────────────────────────
-- SELECT level, code, label_en FROM inventory_lists WHERE level IN (1, 9) ORDER BY level, display_order;
-- Expect Level 1: LE/TX/PV/BD (4 rows)
-- Expect Level 9: US/CN/KR/TR/IT/EG/DE/JP/VN/IN/BR/MX (12 rows)
-- SELECT level, COUNT(*) FROM inventory_lists WHERE active = true GROUP BY level ORDER BY level;
-- Expect: 1→4, 2→11, 3→4, 4→6, 5→10, 6→17 (added DG), 7→7, 8→4, 9→12 (total 75)
