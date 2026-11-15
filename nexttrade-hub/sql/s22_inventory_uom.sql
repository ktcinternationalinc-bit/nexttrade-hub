-- S22.11 (Apr 23 2026) — Multi-unit inventory + apples-to-apples P&L.
--
-- Products can be billed in kg, ton, yard, meter, roll, or piece.
-- The P&L view in Product Detail normalizes cost/revenue/profit into
-- as many units as it can derive for a given product.
--
-- Columns added:
--   uom                    - the natural unit the product is bought/sold in
--   linear_density_g_per_m - grams per meter; REQUIRED for yard/meter
--                             products so we can also express per-kg/per-ton
--                             (apples-to-apples vs. weight-priced products).
--
-- Safe to run multiple times — idempotent.

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS uom TEXT,
  ADD COLUMN IF NOT EXISTS linear_density_g_per_m NUMERIC;

-- Optional sanity check — shows the columns are there.
SELECT 'inventory.uom and linear_density_g_per_m ready' AS status,
       count(*) FILTER (WHERE uom IS NOT NULL) AS products_with_uom,
       count(*) FILTER (WHERE linear_density_g_per_m IS NOT NULL) AS products_with_linear_density
FROM inventory;
