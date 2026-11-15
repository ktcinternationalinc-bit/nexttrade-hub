-- ============================================================
-- CHECK ↔ TREASURY EXPLICIT LINKING + PAYMENT SOURCE
-- Safe to re-run.
-- ============================================================

-- 1. ADD COLUMNS
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS source_check_id UUID REFERENCES checks(id) ON DELETE SET NULL;
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS payment_source TEXT;
-- payment_source values: 'cash', 'bank', 'check', 'vodafone', 'instapay'
-- (denormalized — convenience field for grouping/filtering)

ALTER TABLE checks ADD COLUMN IF NOT EXISTS physical_check_returned BOOLEAN DEFAULT FALSE;
-- TRUE when customer took the paper check back (cash-swap case)

CREATE INDEX IF NOT EXISTS idx_treasury_source_check ON treasury(source_check_id) WHERE source_check_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_treasury_payment_source ON treasury(payment_source) WHERE payment_source IS NOT NULL;

-- 2. BACKFILL source_check_id — for any check that already has linked_treasury_id set,
--    write the reverse pointer onto the treasury row.
UPDATE treasury t
SET source_check_id = c.id
FROM checks c
WHERE c.linked_treasury_id = t.id
  AND t.source_check_id IS NULL;

-- 3. BACKFILL payment_source on treasury rows
-- Order matters — most specific wins.

-- 3a. Rows with source_check_id set → 'check'
UPDATE treasury SET payment_source = 'check'
WHERE source_check_id IS NOT NULL AND payment_source IS NULL;

-- 3b. Bank rows (bank_in or bank_out > 0, OR matched_bank_txn_id, OR placeholder) → 'bank'
UPDATE treasury SET payment_source = 'bank'
WHERE payment_source IS NULL
  AND (bank_in > 0 OR bank_out > 0 OR matched_bank_txn_id IS NOT NULL OR is_bank_placeholder = TRUE);

-- 3c. cash_method rows → use the channel name
UPDATE treasury SET payment_source = cash_method
WHERE payment_source IS NULL AND cash_method IN ('vodafone', 'instapay');

-- 3d. Description-pattern fallback: rows whose description suggests a check collection
UPDATE treasury SET payment_source = 'check'
WHERE payment_source IS NULL
  AND (description LIKE '%شيك محصّل%' OR description LIKE '%شيك محصل%' OR description ILIKE '%check collected%');

-- 3e. Everything else with cash_in/cash_out → 'cash'
UPDATE treasury SET payment_source = 'cash'
WHERE payment_source IS NULL
  AND (cash_in > 0 OR cash_out > 0);

-- 4. VERIFICATION
SELECT 'treasury rows with source_check_id' AS what, COUNT(*) AS n FROM treasury WHERE source_check_id IS NOT NULL
UNION ALL
SELECT 'treasury rows with payment_source set', COUNT(*) FROM treasury WHERE payment_source IS NOT NULL
UNION ALL
SELECT 'treasury payment_source = check', COUNT(*) FROM treasury WHERE payment_source = 'check'
UNION ALL
SELECT 'treasury payment_source = bank', COUNT(*) FROM treasury WHERE payment_source = 'bank'
UNION ALL
SELECT 'treasury payment_source = cash', COUNT(*) FROM treasury WHERE payment_source = 'cash'
UNION ALL
SELECT 'checks with physical_check_returned column', COUNT(*) FROM checks WHERE physical_check_returned IS NOT NULL;
