-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TG2 — SHIPPING TERMS ON THE INVOICE (Max, Nov 16 2026)
-- "always have a value and only one value. Final confirmed value is based on bill."
-- Adds two columns to the EXISTING report table pl_invoice_terms (one row per invoice = one value).
-- Nothing is deleted or changed in any existing row. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pl_invoice_terms ADD COLUMN IF NOT EXISTS shipping_terms text;
ALTER TABLE public.pl_invoice_terms ADD COLUMN IF NOT EXISTS shipping_cost_estimate numeric;

-- only the three choices are allowed (or empty = not chosen yet)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_invoice_terms_shipping_terms_check') THEN
    ALTER TABLE public.pl_invoice_terms ADD CONSTRAINT pl_invoice_terms_shipping_terms_check
      CHECK (shipping_terms IS NULL OR shipping_terms IN ('EXW', 'CNF_INCLUDED', 'CNF_SEPARATE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_invoice_terms_shipping_cost_check') THEN
    ALTER TABLE public.pl_invoice_terms ADD CONSTRAINT pl_invoice_terms_shipping_cost_check
      CHECK (shipping_cost_estimate IS NULL OR shipping_cost_estimate >= 0);
  END IF;
END $$;

-- proof: should list the two new columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pl_invoice_terms' AND column_name IN ('shipping_terms', 'shipping_cost_estimate')
ORDER BY column_name;
