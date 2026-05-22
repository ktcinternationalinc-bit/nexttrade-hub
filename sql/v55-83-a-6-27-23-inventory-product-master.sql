-- v55.83-A.6.27.23 — Inventory Phase 1 Build 2: Product Master
--
-- Adds the `inventory_products` table — the catalog of every product
-- the business stocks, classified via the 8-level hierarchy from Build 1.
--
-- This migration is PURELY ADDITIVE — does not touch any existing tables
-- (inventory_lists, inventory_list_rules, inv_skus, etc. all untouched).
--
-- Run this in Supabase SQL editor BEFORE deploying the v55.83-A.6.27.23 code.

CREATE TABLE IF NOT EXISTS inventory_products (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name_en                     text NOT NULL,
  name_ar                     text NOT NULL,
  quick_code                  text,      -- optional, unique among active rows when set
  design_sku                  text,      -- optional, free-text

  -- Classification (foreign keys to inventory_lists)
  family_list_id              uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,
  category_list_id            uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,
  grade_list_id               uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,
  construction_list_id        uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,
  backing_list_id             uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,
  color_list_id               uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,
  pattern_list_id             uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,
  spec_class_list_id          uuid REFERENCES inventory_lists(id) ON DELETE RESTRICT,

  -- Computed slug — dot-joined codes for fast reporting filters
  -- e.g. "P.MS.PR.RG.NA.DB.NM.15"
  -- We allow NULL during draft state but require all 8 codes for an active product.
  classification_slug         text,

  -- Tech spec defaults (all optional — used to pre-fill receiving forms)
  default_uom                 text,        -- kg, meter, yard, roll, piece, liter, sqm
  default_thickness_mm        numeric,
  default_width_m             numeric,
  default_gsm                 numeric,
  default_density             numeric,
  default_weight_per_roll     numeric,
  default_roll_length_m       numeric,

  -- Operational defaults
  default_supplier            text,
  default_cost                numeric,
  default_currency            text,        -- EGP / USD / EUR
  default_rack                text,

  notes                       text,
  active                      boolean NOT NULL DEFAULT true,

  -- Audit
  created_by                  uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid,
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_default_uom CHECK (
    default_uom IS NULL OR default_uom IN ('kg','meter','yard','roll','piece','liter','sqm')
  ),
  CONSTRAINT chk_default_currency CHECK (
    default_currency IS NULL OR default_currency IN ('EGP','USD','EUR')
  )
);

-- Quick code unique only among active products (so deactivated codes can be reused)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_products_quick_code_active
  ON inventory_products (quick_code)
  WHERE active = true AND quick_code IS NOT NULL AND quick_code != '';

-- Common-query indexes
CREATE INDEX IF NOT EXISTS idx_inventory_products_family       ON inventory_products (family_list_id);
CREATE INDEX IF NOT EXISTS idx_inventory_products_category     ON inventory_products (category_list_id);
CREATE INDEX IF NOT EXISTS idx_inventory_products_active       ON inventory_products (active);
CREATE INDEX IF NOT EXISTS idx_inventory_products_slug         ON inventory_products (classification_slug);
CREATE INDEX IF NOT EXISTS idx_inventory_products_design_sku   ON inventory_products (design_sku) WHERE design_sku IS NOT NULL;

-- Search by product name (trigram-like would be nicer; for now btree on lower())
CREATE INDEX IF NOT EXISTS idx_inventory_products_name_en_lower
  ON inventory_products (lower(name_en));

-- updated_at auto-bump trigger
CREATE OR REPLACE FUNCTION update_inventory_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inventory_products_updated_at ON inventory_products;
CREATE TRIGGER trigger_inventory_products_updated_at
BEFORE UPDATE ON inventory_products
FOR EACH ROW EXECUTE FUNCTION update_inventory_products_updated_at();

-- RLS
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_products_read  ON inventory_products;
CREATE POLICY inv_products_read  ON inventory_products FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_products_write ON inventory_products;
CREATE POLICY inv_products_write ON inventory_products FOR ALL USING (true) WITH CHECK (true);

-- Verify after running:
--   SELECT COUNT(*) FROM inventory_products;   -- expect 0 (empty catalog)
--   \d inventory_products                       -- inspect the schema
