-- ============================================================
-- v55.83-AY — Lock payment -> invoice -> Wave compatibility.
-- Adds Wave-sync fields to accounting_invoice_payments, backfills payment rows
-- for any existing payment_matches, and reconciles invoice balances to the
-- canonical formula: amount_paid = wave_imported_paid + SUM(hub payment rows).
-- Additive + idempotent. Run before deploying AY.
-- ============================================================

ALTER TABLE accounting_invoice_payments ADD COLUMN IF NOT EXISTS wave_invoice_id  text;
ALTER TABLE accounting_invoice_payments ADD COLUMN IF NOT EXISTS wave_customer_id text;
ALTER TABLE accounting_invoice_payments ADD COLUMN IF NOT EXISTS last_synced_at   timestamptz;
ALTER TABLE accounting_invoice_payments ADD COLUMN IF NOT EXISTS sync_error       text;

-- Backfill: every existing payment_match should have a Wave-syncable payment row.
INSERT INTO accounting_invoice_payments
  (business_id, accounting_invoice_id, accounting_customer_id, amount, payment_date,
   source, bank_transaction_id, payment_match_id, sync_status, wave_invoice_id, wave_customer_id, created_by, created_at)
SELECT pm.business_id, pm.invoice_id, ai.accounting_customer_id, pm.matched_amount,
       COALESCE(bt.posted_date, bt.date, CURRENT_DATE), 'plaid_match', pm.bank_transaction_id, pm.id,
       'pending_wave_sync', ai.wave_invoice_id, ac.wave_customer_id, pm.created_by, COALESCE(pm.created_at, now())
FROM payment_matches pm
JOIN accounting_invoices ai ON ai.id = pm.invoice_id
LEFT JOIN accounting_customers ac ON ac.id = ai.accounting_customer_id
LEFT JOIN bank_transactions bt ON bt.id = pm.bank_transaction_id
WHERE NOT EXISTS (SELECT 1 FROM accounting_invoice_payments aip WHERE aip.payment_match_id = pm.id)
  AND NOT EXISTS (SELECT 1 FROM accounting_invoice_payments a2
                  WHERE a2.accounting_invoice_id = pm.invoice_id
                    AND a2.bank_transaction_id = pm.bank_transaction_id
                    AND pm.bank_transaction_id IS NOT NULL);

-- Reconcile ALL invoice balances to the canonical formula (no double-count;
-- preserves wave_imported_paid, adds hub/plaid payment rows on top).
UPDATE accounting_invoices ai SET
  amount_paid    = np.ap,
  balance_due    = ROUND(COALESCE(ai.total_amount, 0) - np.ap, 2),
  payment_status = CASE
                     WHEN ROUND(COALESCE(ai.total_amount, 0) - np.ap, 2) <= 0.0001 THEN 'paid'
                     WHEN np.ap > 0.0001 THEN 'partial'
                     ELSE 'unpaid'
                   END
FROM (
  SELECT ai2.id,
         ROUND(COALESCE(ai2.wave_imported_paid, 0)
               + COALESCE((SELECT SUM(p.amount) FROM accounting_invoice_payments p
                           WHERE p.accounting_invoice_id = ai2.id), 0), 2) AS ap
  FROM accounting_invoices ai2
) np
WHERE np.id = ai.id;
