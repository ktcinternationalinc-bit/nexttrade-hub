-- v55.83-A.6.27.22 — Inventory Phase 1 Build 1: Master Lists schema
--
-- Creates the foundation tables for the inventory classification system.
-- This migration is PURELY ADDITIVE — no existing tables touched.
--
-- Two new tables:
--   1. inventory_lists      — dropdown options for the 8 classification levels
--   2. inventory_list_rules — which child options are valid under which parents
--
-- Plus pre-loaded seed data from Max's original spec document.
--
-- Run this in Supabase SQL editor BEFORE deploying the v55.83-A.6.27.22 code.

-- ── Table 1: inventory_lists ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level         integer NOT NULL CHECK (level BETWEEN 1 AND 8),
  code          text NOT NULL,
  label_en      text NOT NULL,
  label_ar      text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_code_format CHECK (code ~ '^[A-Z0-9]{1,4}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_lists_code_active
  ON inventory_lists (level, code) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_inventory_lists_level_order
  ON inventory_lists (level, display_order, label_en);

CREATE OR REPLACE FUNCTION update_inventory_lists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inventory_lists_updated_at ON inventory_lists;
CREATE TRIGGER trigger_inventory_lists_updated_at
BEFORE UPDATE ON inventory_lists
FOR EACH ROW EXECUTE FUNCTION update_inventory_lists_updated_at();

-- ── Table 2: inventory_list_rules ────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_list_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_list_id   uuid NOT NULL REFERENCES inventory_lists(id) ON DELETE CASCADE,
  parent_list_id  uuid NOT NULL REFERENCES inventory_lists(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (child_list_id, parent_list_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_list_rules_child  ON inventory_list_rules (child_list_id);
CREATE INDEX IF NOT EXISTS idx_inventory_list_rules_parent ON inventory_list_rules (parent_list_id);

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE inventory_lists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_list_rules  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_lists_read       ON inventory_lists;
CREATE POLICY inv_lists_read       ON inventory_lists       FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_lists_write      ON inventory_lists;
CREATE POLICY inv_lists_write      ON inventory_lists       FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS inv_list_rules_read  ON inventory_list_rules;
CREATE POLICY inv_list_rules_read  ON inventory_list_rules  FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_list_rules_write ON inventory_list_rules;
CREATE POLICY inv_list_rules_write ON inventory_list_rules  FOR ALL USING (true) WITH CHECK (true);

-- ── Seed data — from Max's original spec document ────────────────

-- Level 1: Product Family
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (1, 'L', 'Leather',      'جلد',           1),
  (1, 'T', 'Textile',      'منسوجات',       2),
  (1, 'P', 'PVC Pool',     'PVC مسابح',     3),
  (1, 'B', 'Boat Decking', 'أرضيات قوارب',  4)
ON CONFLICT DO NOTHING;

-- Level 2: Category (parent-restricted)
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (2, 'SM', 'Smooth',             'ناعم',          1),
  (2, 'EM', 'Embossed',           'منقوش',         2),
  (2, 'HL', 'Headliner',          'سقف سيارات',    3),
  (2, 'AF', 'Automotive Fabric',  'قماش سيارات',   4),
  (2, 'SL', 'Smooth Liner',       'لاينر ناعم',    5),
  (2, 'RF', 'Roofing',            'تغطية',         6),
  (2, 'MS', 'Mosaic',             'موزاييك',       7),
  (2, 'AS', 'Anti-Slip',          'مانع انزلاق',   8),
  (2, 'LT', 'Light',              'خفيف',          9),
  (2, 'MD', 'Medium',             'متوسط',        10),
  (2, 'HV', 'Heavy',              'ثقيل',         11)
ON CONFLICT DO NOTHING;

INSERT INTO inventory_list_rules (child_list_id, parent_list_id)
SELECT c.id, p.id FROM inventory_lists c, inventory_lists p
WHERE
  (c.level = 2 AND c.code IN ('SM','EM')               AND p.level = 1 AND p.code = 'L')
  OR (c.level = 2 AND c.code IN ('HL','AF')             AND p.level = 1 AND p.code = 'T')
  OR (c.level = 2 AND c.code IN ('SL','RF','MS','AS')   AND p.level = 1 AND p.code = 'P')
  OR (c.level = 2 AND c.code IN ('LT','MD','HV')        AND p.level = 1 AND p.code = 'B')
ON CONFLICT DO NOTHING;

-- Level 3: Grade
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (3, 'LX', 'Luxurious',      'فاخر',     1),
  (3, 'PR', 'Premium',        'بريميوم',  2),
  (3, 'ST', 'Stock',          'ستوك',     3),
  (3, 'NA', 'Not Applicable', 'غير مطبق', 4)
ON CONFLICT DO NOTHING;

-- Level 4: Construction
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (4, 'RG', 'Regular',             'عادي',            1),
  (4, 'PF', 'Perforated',          'مخرم',            2),
  (4, 'FP', 'Foam Perforated',     'إسفنج مخرم',       3),
  (4, 'FN', 'Foam Non-Perforated', 'إسفنج غير مخرم',   4),
  (4, 'TL', 'Tri-Lam',             'ثلاثي الطبقات',    5),
  (4, 'NA', 'Not Applicable',      'غير مطبق',        6)
ON CONFLICT DO NOTHING;

-- Level 5: Backing
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (5, 'CT', 'Cotton',         'قطن',          1),
  (5, 'FL', 'Felt',           'لباد',         2),
  (5, 'GR', 'Gray',           'رمادي',        3),
  (5, 'BK', 'Black',          'أسود',         4),
  (5, 'SU', 'Suede',          'شامواه',       5),
  (5, 'GS', 'Gray Suede',     'شامواه رمادي', 6),
  (5, 'NW', 'Non-Woven',      'نون ووفن',     7),
  (5, 'PL', 'Plastic',        'بلاستيك',      8),
  (5, 'OT', 'Other',          'أخرى',         9),
  (5, 'NA', 'Not Applicable', 'غير مطبق',    10)
ON CONFLICT DO NOTHING;

-- Level 6: Color — pool colors are parent-restricted (next block)
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  -- Standard (universal)
  (6, 'BK', 'Black',       'أسود',          1),
  (6, 'BG', 'Beige',       'بيج',           2),
  (6, 'BN', 'Brown',       'بني',           3),
  (6, 'RD', 'Red',         'أحمر',          4),
  (6, 'MR', 'Maroon',      'نبيتي',         5),
  (6, 'HV', 'Havana',      'هافان',         6),
  (6, 'OL', 'Olive',       'زيتي',          7),
  (6, 'SW', 'Snow White',  'أبيض ثلجي',     8),
  (6, 'WH', 'White',       'أبيض',          9),
  (6, 'GR', 'Gray',        'رمادي',        10),
  (6, 'LG', 'Light Gray',  'رمادي فاتح',   11),
  -- Pool (restricted to PVC Pool)
  (6, 'BB', 'Baby Blue',   'أزرق فاتح',    12),
  (6, 'SB', 'Sky Blue',    'أزرق سماوي',   13),
  (6, 'MB', 'Medium Blue', 'أزرق متوسط',   14),
  (6, 'DB', 'Dark Blue',   'أزرق غامق',    15),
  (6, 'NB', 'Navy Blue',   'كحلي',         16)
ON CONFLICT DO NOTHING;

INSERT INTO inventory_list_rules (child_list_id, parent_list_id)
SELECT c.id, p.id FROM inventory_lists c, inventory_lists p
WHERE c.level = 6 AND c.code IN ('BB','SB','MB','DB','NB')
  AND p.level = 1 AND p.code = 'P'
ON CONFLICT DO NOTHING;

-- Level 7: Pattern
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (7, 'NA', 'None',             'بدون',              1),
  (7, 'CL', 'Classical Mosaic', 'موزاييك كلاسيك',    2),
  (7, 'NM', 'New Mosaic',       'موزاييك جديد',      3),
  (7, 'LS', 'Large Square',     'مربعات كبيرة',      4),
  (7, 'SS', 'Small Square',     'مربعات صغيرة',      5),
  (7, 'HC', 'Honeycomb',        'خلية نحل',          6),
  (7, 'MG', 'Mechanical Grain', 'حبيبات ميكانيكية',  7)
ON CONFLICT DO NOTHING;

-- Level 8: Spec Class
INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES
  (8, 'L5', 'Less Than 1.5mm',   'أقل من 1.5 مم', 1),
  (8, '15', '1.5mm',              '1.5 مم',        2),
  (8, 'G5', 'Greater Than 1.5mm', 'أكبر من 1.5 مم', 3),
  (8, 'NA', 'Not Applicable',     'غير مطبق',      4)
ON CONFLICT DO NOTHING;

-- Verify after running:
--   SELECT level, COUNT(*) FROM inventory_lists GROUP BY level ORDER BY level;
--     Expect: 1→4, 2→11, 3→4, 4→6, 5→10, 6→16, 7→7, 8→4 (total 62)
--   SELECT COUNT(*) FROM inventory_list_rules;
--     Expect: 16 (11 category-family + 5 pool-color)
