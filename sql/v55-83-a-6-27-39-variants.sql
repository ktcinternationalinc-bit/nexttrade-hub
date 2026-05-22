-- v55.83-A.6.27.39 — Variant system (family templates + sequential variants)
--
-- Adds two columns to inventory_products:
--   is_family_template  — TRUE for the 27 starter rows, FALSE for variants
--   variant_suffix      — empty for templates, '001'/'002'/... for variants
--
-- Plus a new function: get_or_create_variant(p_template_id, p_category, ...)
--   - Looks up an existing variant with matching specs
--   - Creates a new one with next sequential suffix if not found
--   - Returns the variant_id

-- ── New columns ─────────────────────────────────────────────────
ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS is_family_template boolean NOT NULL DEFAULT false;

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS variant_suffix text;

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS parent_template_id uuid REFERENCES inventory_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inv_products_family_template ON inventory_products (is_family_template) WHERE is_family_template = true;
CREATE INDEX IF NOT EXISTS idx_inv_products_parent_template ON inventory_products (parent_template_id) WHERE parent_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_products_variant_suffix  ON inventory_products (parent_template_id, variant_suffix) WHERE variant_suffix IS NOT NULL;

-- ── Variant creation function ───────────────────────────────────
-- Inputs: template_id + the 4 variable level codes (cat/constr/back/pattern)
-- Behavior: silent reuse if a matching variant exists; else create new with next suffix.
-- Returns: variant_id (the row in inventory_products that the receipt should reference).
CREATE OR REPLACE FUNCTION get_or_create_variant(
  p_template_id   uuid,
  p_category_code text,
  p_construction_code text,
  p_backing_code  text,
  p_pattern_code  text,
  p_user_id       uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_template      inventory_products%ROWTYPE;
  v_category_id   uuid;
  v_construction_id uuid;
  v_backing_id    uuid;
  v_pattern_id    uuid;
  v_variant_id    uuid;
  v_next_suffix   text;
  v_next_n        integer;
  v_family_code   text;
  v_grade_code    text;
  v_color_code    text;
  v_origin_code   text;
  v_variant_name  text;
  v_variant_quick text;
BEGIN
  -- 1. Load template
  SELECT * INTO v_template FROM inventory_products WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Family template % not found', p_template_id;
  END IF;
  IF NOT v_template.is_family_template THEN
    RAISE EXCEPTION 'Product % is not a family template', p_template_id;
  END IF;

  -- 2. Resolve level codes to list IDs (validate they exist)
  SELECT id INTO v_category_id     FROM inventory_lists WHERE level = 2 AND code = p_category_code     AND active = true;
  SELECT id INTO v_construction_id FROM inventory_lists WHERE level = 4 AND code = p_construction_code AND active = true;
  SELECT id INTO v_backing_id      FROM inventory_lists WHERE level = 5 AND code = p_backing_code      AND active = true;
  SELECT id INTO v_pattern_id      FROM inventory_lists WHERE level = 7 AND code = p_pattern_code      AND active = true;
  IF v_category_id     IS NULL THEN RAISE EXCEPTION 'Category code "%" not found in Master Lists', p_category_code; END IF;
  IF v_construction_id IS NULL THEN RAISE EXCEPTION 'Construction code "%" not found in Master Lists', p_construction_code; END IF;
  IF v_backing_id      IS NULL THEN RAISE EXCEPTION 'Backing code "%" not found in Master Lists', p_backing_code; END IF;
  IF v_pattern_id      IS NULL THEN RAISE EXCEPTION 'Pattern code "%" not found in Master Lists', p_pattern_code; END IF;

  -- 3. Silent reuse: look for an existing variant with matching specs under this template
  SELECT id INTO v_variant_id
  FROM inventory_products
  WHERE parent_template_id = p_template_id
    AND category_list_id     = v_category_id
    AND construction_list_id = v_construction_id
    AND backing_list_id      = v_backing_id
    AND pattern_list_id      = v_pattern_id
    AND active = true
  LIMIT 1;

  IF v_variant_id IS NOT NULL THEN
    -- Found existing — return it
    RETURN v_variant_id;
  END IF;

  -- 4. No match — create a new variant with next sequential suffix
  -- Find the next suffix number under this template (max + 1)
  SELECT COALESCE(MAX(CAST(variant_suffix AS integer)), 0) + 1
    INTO v_next_n
  FROM inventory_products
  WHERE parent_template_id = p_template_id
    AND variant_suffix ~ '^\d+$';

  v_next_suffix := lpad(v_next_n::text, 3, '0');

  -- Get the level codes for the slug + name
  SELECT code INTO v_family_code FROM inventory_lists WHERE id = v_template.family_list_id;
  SELECT code INTO v_grade_code  FROM inventory_lists WHERE id = v_template.grade_list_id;
  SELECT code INTO v_color_code  FROM inventory_lists WHERE id = v_template.color_list_id;
  SELECT code INTO v_origin_code FROM inventory_lists WHERE id = v_template.origin_list_id;

  -- Build display name + quick_code_full
  v_variant_name := v_template.name_en
    || ' · ' || p_category_code
    || ' · ' || p_construction_code
    || ' · ' || p_backing_code
    || ' · ' || p_pattern_code
    || ' [' || v_next_suffix || ']';

  v_variant_quick := v_template.quick_code;  -- variants share parent's quick_code

  INSERT INTO inventory_products (
    quick_code,
    variant_suffix,
    parent_template_id,
    is_family_template,
    name_en,
    name_ar,
    family_list_id,
    category_list_id,
    grade_list_id,
    construction_list_id,
    backing_list_id,
    color_list_id,
    pattern_list_id,
    spec_class_list_id,
    origin_list_id,
    classification_slug,
    default_uom,
    default_currency,
    default_supplier,
    default_cost,
    default_rack,
    notes,
    featured,
    active,
    created_by,
    updated_by
  ) VALUES (
    v_template.quick_code,
    v_next_suffix,
    p_template_id,
    false,                                -- this is a variant, not a template
    v_variant_name,
    v_template.name_ar,
    v_template.family_list_id,
    v_category_id,
    v_template.grade_list_id,
    v_construction_id,
    v_backing_id,
    v_template.color_list_id,
    v_pattern_id,
    v_template.spec_class_list_id,
    v_template.origin_list_id,
    v_family_code || '-' || p_category_code || '-' || v_grade_code || '-' ||
      p_construction_code || '-' || p_backing_code || '-' || v_color_code || '-' ||
      p_pattern_code || '-NA-' || v_origin_code,
    v_template.default_uom,
    v_template.default_currency,
    v_template.default_supplier,
    v_template.default_cost,
    v_template.default_rack,
    'Auto-created variant from template ' || v_template.quick_code || ' at receipt time',
    false,
    true,
    p_user_id,
    p_user_id
  ) RETURNING id INTO v_variant_id;

  RETURN v_variant_id;
END;
$$ LANGUAGE plpgsql;

-- ── Verify ──────────────────────────────────────────────────────
-- After importing the 27 family templates, run:
--   SELECT COUNT(*) FROM inventory_products WHERE is_family_template = true;
--   Expected: 27
--   SELECT COUNT(*) FROM inventory_products WHERE is_family_template = false;
--   Expected: 0 (no variants yet — they'll be created at receipt time)
