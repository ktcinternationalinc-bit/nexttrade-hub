-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-OA — P.O./S.O. NUMBER from Wave
-- The Wave pull never fetched the P.O./S.O. field — the number Max's team
-- uses to tie invoices to NextTrade releases. This column receives it; the
-- next Wave sync backfills every invoice automatically.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS po_so_number text;
CREATE INDEX IF NOT EXISTS idx_acct_inv_po_so ON accounting_invoices (po_so_number);

-- VERIFICATION
SELECT 'accounting_invoices.po_so_number' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_invoices' AND column_name='po_so_number') THEN '✅ exists' ELSE '❌ MISSING' END AS result;
