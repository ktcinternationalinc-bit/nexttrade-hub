-- v55.82-C — Add other_fees_desc column to shipping_rates
--
-- Why: the import template ALWAYS had an "Other Fees Description" column
-- (column 20 of 21). Users typed "BAF" / "CAF" / "ISPS" labels there to
-- explain what the surcharge was for. The import was dropping that label
-- on the floor before this build. Now the import captures it; without
-- this column in the DB, the executeImport retry-loop will strip it and
-- the data still goes in clean — but you lose the labels. Run this
-- migration to keep them.
--
-- Safe to re-run: IF NOT EXISTS guards make this idempotent.

ALTER TABLE shipping_rates
  ADD COLUMN IF NOT EXISTS other_fees_desc TEXT;

-- Optional: add a comment so future readers of the schema know what
-- this column is for.
COMMENT ON COLUMN shipping_rates.other_fees_desc IS
  'Free-text label for the surcharge in other_fees (e.g. BAF, CAF, ISPS). Populated by import + manual entry.';
