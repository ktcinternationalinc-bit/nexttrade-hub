-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-NQ — AUTOMATED RECONCILIATION (every 6 hours)
-- flagged_at records that a missing-invoice order was already put on a ticket,
-- so the 6-hour cron flags each gap ONCE, not every 6 hours forever.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE nexttrade_orders ADD COLUMN IF NOT EXISTS flagged_at timestamptz;

-- VERIFICATION
SELECT 'nexttrade_orders.flagged_at' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nexttrade_orders' AND column_name='flagged_at') THEN '✅ exists' ELSE '❌ MISSING' END AS result;
