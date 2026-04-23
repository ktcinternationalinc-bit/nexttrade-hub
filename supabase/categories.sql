-- ============================================================
-- CATEGORIES TABLE — bilingual (AR + EN)
-- Safe to re-run. Creates the table, seeds from the hardcoded
-- EXPENSE_CATS map, and migrates legacy __CATEGORY__ entries
-- out of expense_rules into the categories table.
-- Does NOT delete anything. Does NOT touch existing data.
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar    TEXT,
  name_en    TEXT,
  parent_id  UUID REFERENCES categories(id) ON DELETE CASCADE,
  type       TEXT DEFAULT 'expense' CHECK (type IN ('expense','income')),
  active     BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  CONSTRAINT name_at_least_one CHECK (name_ar IS NOT NULL OR name_en IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_categories_type   ON categories(type)   WHERE active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_name_ar
  ON categories(name_ar) WHERE name_ar IS NOT NULL AND parent_id IS NULL;

-- RLS permissive (API uses service role)
DO $$ BEGIN ALTER TABLE categories ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "categories_all_ops" ON categories FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed from the hardcoded EXPENSE_CATS map (idempotent via ON CONFLICT on name_ar)
INSERT INTO categories (name_ar, name_en, type) VALUES
  ('مبيعات',         'Sales',      'income'),
  ('عهدة المخزن',    'Warehouse',  'expense'),
  ('مرتبات',         'Salaries',   'expense'),
  ('مواصلات وسفر',   'Transport',  'expense'),
  ('ايجار ومرافق',   'Rent',       'expense'),
  ('عمالة واكراميات','Labor',      'expense'),
  ('سحب المالك',     'Owner Draws','expense'),
  ('تحويلات بنكية',  'Banking',    'expense'),
  ('زكاة وصدقات',    'Charity',    'expense'),
  ('شحن وجمارك',     'Shipping',   'expense'),
  ('جمارك',          'Customs',    'expense'),
  ('عينات',          'Samples',    'expense'),
  ('ضرائب',          'Taxes',      'expense'),
  ('مصروفات تشغيل',  'Operations', 'expense')
ON CONFLICT (name_ar) WHERE name_ar IS NOT NULL AND parent_id IS NULL DO UPDATE
  SET name_en = COALESCE(EXCLUDED.name_en, categories.name_en);

-- ============================================================
-- MIGRATE legacy __CATEGORY__ entries out of expense_rules
-- ============================================================
-- The previous Settings UI stored user-added categories as
-- expense_rules rows with description_match = '__CATEGORY__<n>'.
-- Move them into the categories table, picking the AR vs EN
-- column based on whether the stored string contains Arabic
-- characters. Idempotent: ON CONFLICT DO NOTHING on name_ar.
-- ============================================================

-- Pass 1 — rows where category contains non-ASCII characters (Arabic in practice)
INSERT INTO categories (name_ar, name_en, type, active, sort_order)
SELECT DISTINCT
  r.category,
  NULL,
  COALESCE(NULLIF(r.rule_type,''), 'expense'),
  TRUE,
  200
FROM expense_rules r
WHERE r.description_match LIKE '\_\_CATEGORY\_\_%' ESCAPE '\'
  AND r.category IS NOT NULL
  AND TRIM(r.category) <> ''
  AND r.category ~ '[^[:ascii:]]'
ON CONFLICT (name_ar) WHERE name_ar IS NOT NULL AND parent_id IS NULL DO NOTHING;

-- Pass 2 — rows where category is pure ASCII (English). Anti-join against any
-- existing row (either language side) to prevent duplicates.
INSERT INTO categories (name_ar, name_en, type, active, sort_order)
SELECT DISTINCT
  NULL,
  r.category,
  COALESCE(NULLIF(r.rule_type,''), 'expense'),
  TRUE,
  200
FROM expense_rules r
WHERE r.description_match LIKE '\_\_CATEGORY\_\_%' ESCAPE '\'
  AND r.category IS NOT NULL
  AND TRIM(r.category) <> ''
  AND r.category !~ '[^[:ascii:]]'
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.parent_id IS NULL
      AND (c.name_en = r.category OR c.name_ar = r.category)
  );

-- Verify
SELECT 'categories seeded' AS what, COUNT(*) AS n
FROM categories WHERE parent_id IS NULL;

SELECT 'migration summary' AS what,
       COUNT(*) FILTER (WHERE sort_order = 200)  AS from_legacy_rules,
       COUNT(*) FILTER (WHERE sort_order <> 200 OR sort_order IS NULL) AS builtin_or_new,
       COUNT(*) FILTER (WHERE active = TRUE)     AS active,
       COUNT(*) FILTER (WHERE active = FALSE)    AS inactive
FROM categories
WHERE parent_id IS NULL;
