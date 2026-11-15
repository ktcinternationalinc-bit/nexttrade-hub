-- v55.83-A.6.27.72 — Unified Counterparty Ledger
-- Adds transaction_type classification + payment-to-invoice matching + offset support.
-- All changes are ADDITIVE — no existing column or constraint is dropped.
-- Backout SQL at the bottom of this file.

-- ──────────────────────────────────────────────────────────────────
-- 1. transaction_type column on open_account_entries
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_account_entries
  ADD COLUMN IF NOT EXISTS transaction_type text;

-- 5 official transaction types:
--   sales_invoice      — we billed them (CREDIT, no cash movement)
--   vendor_bill        — they billed us (DEBIT, no cash movement)
--   payment_received   — they paid us (CREDIT, cash IN)
--   payment_sent       — we paid them (DEBIT, cash OUT)
--   credit_adjustment  — manual adjustment, write-off, etc.
--   offset             — internal-use type, links two opposite-direction entries
ALTER TABLE open_account_entries
  DROP CONSTRAINT IF EXISTS chk_open_account_transaction_type;
ALTER TABLE open_account_entries
  ADD CONSTRAINT chk_open_account_transaction_type
  CHECK (
    transaction_type IS NULL OR
    transaction_type IN (
      'sales_invoice',
      'vendor_bill',
      'payment_received',
      'payment_sent',
      'credit_adjustment',
      'offset'
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- 2. applied_to_entry_id — links a payment to the invoice it pays
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_account_entries
  ADD COLUMN IF NOT EXISTS applied_to_entry_id uuid REFERENCES open_account_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_open_account_entries_applied_to
  ON open_account_entries (applied_to_entry_id)
  WHERE applied_to_entry_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────
-- 3. offset_pair_id — links the two halves of an offset
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_account_entries
  ADD COLUMN IF NOT EXISTS offset_pair_id uuid;

CREATE INDEX IF NOT EXISTS idx_open_account_entries_offset_pair
  ON open_account_entries (offset_pair_id)
  WHERE offset_pair_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────
-- 4. offset_invoice_id + offset_bill_id — what the offset settled
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_account_entries
  ADD COLUMN IF NOT EXISTS offset_invoice_id uuid REFERENCES open_account_entries(id) ON DELETE SET NULL;
ALTER TABLE open_account_entries
  ADD COLUMN IF NOT EXISTS offset_bill_id uuid REFERENCES open_account_entries(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────────
-- 5. Backfill existing rows
-- For each entry without a transaction_type, infer from credit/debit + linked invoice.
-- ──────────────────────────────────────────────────────────────────
UPDATE open_account_entries
SET transaction_type = CASE
  WHEN linked_open_invoice_id IS NOT NULL AND credit_amount IS NOT NULL THEN 'sales_invoice'
  WHEN linked_open_invoice_id IS NOT NULL AND debit_amount IS NOT NULL  THEN 'vendor_bill'
  WHEN credit_amount IS NOT NULL                                        THEN 'payment_received'
  WHEN debit_amount IS NOT NULL                                         THEN 'payment_sent'
  ELSE 'credit_adjustment'
END
WHERE transaction_type IS NULL;

-- ──────────────────────────────────────────────────────────────────
-- 6. RLS — verify policies cover the new columns (per Permanent Rule 9)
-- ──────────────────────────────────────────────────────────────────
-- The existing open_account_entries policies use USING (true) WITH CHECK (true) on
-- authenticated users, so they automatically cover the new columns. No new policies needed.
-- This DO block just verifies they exist; if missing, recreates them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'open_account_entries'::regclass
      AND polname = 'authenticated users read open_account_entries'
  ) THEN
    EXECUTE 'ALTER TABLE open_account_entries ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY "authenticated users read open_account_entries"
             ON open_account_entries FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY "authenticated users insert open_account_entries"
             ON open_account_entries FOR INSERT TO authenticated WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "authenticated users update open_account_entries"
             ON open_account_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "authenticated users delete open_account_entries"
             ON open_account_entries FOR DELETE TO authenticated USING (true)';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT (if needed):
-- ──────────────────────────────────────────────────────────────────
--   ALTER TABLE open_account_entries DROP CONSTRAINT IF EXISTS chk_open_account_transaction_type;
--   ALTER TABLE open_account_entries DROP COLUMN IF EXISTS transaction_type;
--   ALTER TABLE open_account_entries DROP COLUMN IF EXISTS applied_to_entry_id;
--   ALTER TABLE open_account_entries DROP COLUMN IF EXISTS offset_pair_id;
--   ALTER TABLE open_account_entries DROP COLUMN IF EXISTS offset_invoice_id;
--   ALTER TABLE open_account_entries DROP COLUMN IF EXISTS offset_bill_id;
