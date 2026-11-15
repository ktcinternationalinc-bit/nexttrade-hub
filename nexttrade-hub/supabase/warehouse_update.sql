-- Add subcategory and description_en columns to warehouse_expenses
ALTER TABLE warehouse_expenses ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE warehouse_expenses ADD COLUMN IF NOT EXISTS description_en TEXT;
