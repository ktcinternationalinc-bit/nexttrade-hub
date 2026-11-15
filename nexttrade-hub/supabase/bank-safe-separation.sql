-- =====================================================================
-- BANK / SAFE SEPARATION MIGRATION
-- Date: April 19, 2026
--
-- PURPOSE
-- Separate bank movements from physical safe (cash) movements in the
-- treasury table so that matched bank transactions never inflate the
-- physical safe (Saif) net balance.
--
-- MODEL AFTER THIS MIGRATION
-- - cash_in  / cash_out  = physical safe movements ONLY
-- - bank_in  / bank_out  = bank account movements (tracked, but excluded
--                          from safe net; counted toward invoice collected
--                          when linked)
-- - Treasury "Net" card   = SUM(cash_in) - SUM(cash_out) only
-- - Invoice total_collected = SUM(cash_in + bank_in) for linked rows
--
-- DEPLOY ORDER: run this BEFORE deploying the new page.jsx.
-- Old page.jsx still works against bank_in/bank_out columns (they'll
-- just stay 0 until the new code is pushed) but the auto-matcher will
-- continue writing to cash_in/cash_out until the new code is live.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BACKUP (so the whole change is reversible)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS treasury_backup_bankfix_20260419;
CREATE TABLE treasury_backup_bankfix_20260419 AS SELECT * FROM treasury;

-- Quick sanity: how many rows, how many currently-matched bank rows?
-- SELECT COUNT(*) AS total_rows FROM treasury_backup_bankfix_20260419;
-- SELECT COUNT(*) AS currently_matched_bank_rows
--   FROM treasury_backup_bankfix_20260419
--   WHERE matched_bank_txn_id IS NOT NULL AND is_bank_placeholder = false;


-- ---------------------------------------------------------------------
-- 2. ADD NEW COLUMNS
-- ---------------------------------------------------------------------
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS bank_in  NUMERIC DEFAULT 0;
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS bank_out NUMERIC DEFAULT 0;

-- Optional but useful: flag a row as "non-order bank event" (owner draw,
-- inter-bank transfer, bank fee, loan, refund, other). Used by the radio
-- in the Add Treasury form. For order-linked bank rows this is NULL.
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS bank_nonorder_category TEXT;

-- cash_method: how the cash arrived. 'cash' | 'vodafone' | 'instapay' | NULL.
-- Vodafone Cash and InstaPay auto-sweep to the physical safe, so they count
-- as cash_in/cash_out (affecting safe net) — but the channel tag lets us
-- reconcile against Vodafone/InstaPay statements separately.
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS cash_method TEXT;


-- ---------------------------------------------------------------------
-- 3. MIGRATE EXISTING MATCHED BANK ROWS
-- Move cash_in  -> bank_in  where the row is a matched bank deposit
-- Move cash_out -> bank_out where the row is a matched bank withdrawal
-- is_bank_placeholder IS NULL is treated as false (legacy rows).
-- ---------------------------------------------------------------------
UPDATE treasury
SET bank_in = cash_in,
    cash_in = 0
WHERE matched_bank_txn_id IS NOT NULL
  AND COALESCE(is_bank_placeholder, false) = false
  AND cash_in > 0;

UPDATE treasury
SET bank_out = cash_out,
    cash_out = 0
WHERE matched_bank_txn_id IS NOT NULL
  AND COALESCE(is_bank_placeholder, false) = false
  AND cash_out > 0;


-- ---------------------------------------------------------------------
-- 4. VERIFY THE MIGRATION
--    (These are SELECTs for Max to eyeball. Nothing destructive.)
-- ---------------------------------------------------------------------
-- 4a. How many rows were moved to bank_in/bank_out?
--   SELECT
--     (SELECT COUNT(*) FROM treasury WHERE bank_in  > 0) AS rows_with_bank_in,
--     (SELECT COUNT(*) FROM treasury WHERE bank_out > 0) AS rows_with_bank_out;
--
-- 4b. Any row that has both cash_in AND bank_in (should be 0)?
--   SELECT COUNT(*) FROM treasury WHERE cash_in > 0 AND bank_in > 0;
--
-- 4c. New SAFE net (cash only):
--   SELECT SUM(cash_in) - SUM(cash_out) AS safe_net FROM treasury;
--
-- 4d. New BANK net (bank only):
--   SELECT SUM(bank_in) - SUM(bank_out) AS bank_net FROM treasury;


-- ---------------------------------------------------------------------
-- 5. RECALCULATE INVOICE total_collected
-- After the column move, total_collected for any invoice with matched
-- bank rows needs to re-sum (cash_in + bank_in). Otherwise invoices
-- that had bank-based collections look uncollected.
-- ---------------------------------------------------------------------
WITH sums AS (
  SELECT
    t.linked_invoice_id AS invoice_id,
    SUM(COALESCE(t.cash_in, 0) + COALESCE(t.bank_in, 0)) AS new_collected
  FROM treasury t
  WHERE t.linked_invoice_id IS NOT NULL
    AND COALESCE(t.is_bank_placeholder, false) = false
    AND COALESCE(t.description, '') NOT LIKE '%[bank confirmation%'
  GROUP BY t.linked_invoice_id
)
UPDATE invoices i
SET total_collected = LEAST(sums.new_collected, COALESCE(i.total_amount, 0)),
    outstanding = GREATEST(
      0,
      COALESCE(i.total_amount, 0)
        - LEAST(sums.new_collected, COALESCE(i.total_amount, 0))
    )
FROM sums
WHERE i.id = sums.invoice_id;


-- ---------------------------------------------------------------------
-- 6. HELPFUL INDEXES
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_treasury_bank_in_linked
  ON treasury(linked_invoice_id)
  WHERE bank_in > 0;

CREATE INDEX IF NOT EXISTS idx_treasury_bank_out
  ON treasury(bank_out)
  WHERE bank_out > 0;


-- =====================================================================
-- ROLLBACK (if the change causes problems within the first week):
--   BEGIN;
--   TRUNCATE treasury;
--   INSERT INTO treasury SELECT * FROM treasury_backup_bankfix_20260419;
--   ALTER TABLE treasury DROP COLUMN IF EXISTS bank_in;
--   ALTER TABLE treasury DROP COLUMN IF EXISTS bank_out;
--   ALTER TABLE treasury DROP COLUMN IF EXISTS bank_nonorder_category;
--   -- then re-run the PRIOR recalc job to fix invoices
--   COMMIT;
-- =====================================================================
