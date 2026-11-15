-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-NO — RELEASE NUMBER on invoices (both systems)
-- Every order has TWO references: the Hub's own reference AND the NextTrade
-- release number. The Hub only stored the first. This adds release_number to
-- BOTH invoice tables so the reconciliation can join on it directly.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS release_number text;
ALTER TABLE invoices            ADD COLUMN IF NOT EXISTS release_number text;

CREATE INDEX IF NOT EXISTS idx_acct_inv_release ON accounting_invoices (release_number);
CREATE INDEX IF NOT EXISTS idx_inv_release       ON invoices (release_number);

-- VERIFICATION
SELECT '1. accounting_invoices.release_number' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_invoices' AND column_name='release_number') THEN '✅ exists' ELSE '❌ MISSING' END AS result
UNION ALL
SELECT '2. invoices.release_number',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='release_number') THEN '✅ exists' ELSE '❌ MISSING' END;
