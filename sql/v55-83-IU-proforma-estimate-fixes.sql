-- v55.83-IU — make the Wave-estimate→proforma dedup key PER-SILO (Codex caution) and confirm the
-- proforma line-items table shape (no created_by column; the importer no longer writes it).
--
-- The IQ migration created a GLOBAL unique on wave_estimate_id. A Wave estimate id belongs to one
-- Wave business, but Max's model is explicitly per-silo, so the safe dedup key is
-- (wave_business_id, wave_estimate_id). This drops the global index and creates the composite one.

DROP INDEX IF EXISTS uq_acct_proformas_wave_estimate;
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_proformas_wave_estimate_silo
  ON accounting_proformas (wave_business_id, wave_estimate_id)
  WHERE wave_estimate_id IS NOT NULL;

-- accounting_proforma_items already has: id, business_id, proforma_id, description, quantity,
-- unit_price, line_total, sku, product_ref, sort_order, created_at — and NO created_by. The estimate
-- importer (v55.83-IU) writes only those real columns. Nothing to add here; documented for clarity.

-- VERIFY:
-- SELECT indexname FROM pg_indexes WHERE tablename='accounting_proformas' AND indexname LIKE 'uq_acct_proformas_wave_estimate%';
--   Expected: uq_acct_proformas_wave_estimate_silo (and NOT the old global one).
