-- ============================================================
-- DEDUP HARDENING MIGRATION + RECOVERY
-- Run in Supabase BEFORE deploying the new page.jsx code.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PART 1 — SCHEMA: add dedup_sibling_id for audit trail
-- ─────────────────────────────────────────────────────────────
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS dedup_sibling_id UUID;
CREATE INDEX IF NOT EXISTS idx_treasury_dedup_sibling ON treasury(dedup_sibling_id);

-- Verify the column was added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'treasury' AND column_name = 'dedup_sibling_id';

-- ─────────────────────────────────────────────────────────────
-- PART 2 — AUDIT: find all ambiguous dedup rows across the DB
-- (Run this first to see what needs fixing)
-- ─────────────────────────────────────────────────────────────
SELECT
  t.id                          AS treasury_id,
  t.transaction_date,
  t.description,
  t.linked_invoice_id,
  t.matched_bank_txn_id,
  eb.amount                     AS bank_amount,
  eb.description                AS bank_description,
  -- Try to find a sibling that actually has the money
  (SELECT COUNT(*) FROM treasury s
    WHERE s.id <> t.id
      AND s.linked_invoice_id = t.linked_invoice_id
      AND s.is_bank_placeholder = false
      AND COALESCE(s.cash_in, 0) > 0
      AND COALESCE(s.description, '') NOT LIKE '%[bank confirmation%'
  ) AS sibling_count
FROM treasury t
LEFT JOIN egypt_bank_transactions eb ON eb.id = t.matched_bank_txn_id
WHERE t.matched_bank_txn_id IS NOT NULL
  AND COALESCE(t.cash_in, 0) = 0
  AND COALESCE(t.cash_out, 0) = 0
  AND t.is_bank_placeholder = false
  AND eb.amount IS NOT NULL
  AND ABS(eb.amount) > 0
ORDER BY t.transaction_date DESC;

-- ─────────────────────────────────────────────────────────────
-- PART 3 — RECOVERY for the specific سعيد عبد الغنى case
-- (the two rows shown in your screenshot)
-- ─────────────────────────────────────────────────────────────

-- Step A: verify what the bank transaction actually deposited
SELECT
  t.id, t.transaction_date, t.description, t.cash_in,
  eb.id AS bank_id, eb.amount AS bank_amount, eb.description AS bank_desc
FROM treasury t
LEFT JOIN egypt_bank_transactions eb ON eb.id = t.matched_bank_txn_id
WHERE t.id = 'b6d2e5f6-9b5d-4a6f-9ca4-d5c71f3dca32';

-- Step B: restore cash_in on Row 1 using the real bank amount
-- Replace <bank_amount> with the number from Step A (your earlier screenshot showed ~27,140)
UPDATE treasury
SET cash_in = (
  SELECT ABS(eb.amount)
  FROM egypt_bank_transactions eb
  WHERE eb.id = 'b6d2e5f6-9b5d-4a6f-9ca4-d5c71f3dca32'::uuid
  -- if this returns nothing, replace with the literal number:
  -- e.g. = 27140
),
  description = REPLACE(
    description,
    ' [bank confirmation — not added to collected]',
    ' [RESTORED — dedup was wrong, no real sibling]'
  )
WHERE id = 'b6d2e5f6-9b5d-4a6f-9ca4-d5c71f3dca32';

-- Better version: use the bank amount directly (safer)
UPDATE treasury
SET cash_in = COALESCE((SELECT ABS(amount) FROM egypt_bank_transactions WHERE id = treasury.matched_bank_txn_id), 0),
    description = REPLACE(description, ' [bank confirmation — not added to collected]', ' [RESTORED ' || NOW()::date || ']')
WHERE id = 'b6d2e5f6-9b5d-4a6f-9ca4-d5c71f3dca32'
  AND cash_in = 0
  AND matched_bank_txn_id IS NOT NULL;

-- Step C: delete the stale placeholder (Row 2)
-- Only run this if you confirmed it's a true duplicate of Row 1
DELETE FROM treasury
WHERE id = 'df359deb-3620-4ec2-8d6d-6577739eed60'
  AND is_bank_placeholder = true
  AND cash_in = 0
  AND cash_out = 0;

-- Step D: if you know which invoice this belongs to, link it
-- UPDATE treasury
-- SET linked_invoice_id = '<invoice_uuid_here>'
-- WHERE id = 'b6d2e5f6-9b5d-4a6f-9ca4-d5c71f3dca32';
--
-- Then open that invoice in the UI to trigger recalcInvoiceCollected

-- Step E: verify the fix
SELECT id, transaction_date, cash_in, cash_out, linked_invoice_id, description
FROM treasury
WHERE id IN (
  'b6d2e5f6-9b5d-4a6f-9ca4-d5c71f3dca32',
  'df359deb-3620-4ec2-8d6d-6577739eed60'
);

-- ─────────────────────────────────────────────────────────────
-- PART 4 — BULK RECOVERY (use with caution)
-- Restores cash_in on ALL ambiguous-dedup rows, using bank amount.
-- Only run after you've reviewed PART 2 results and agree.
-- ─────────────────────────────────────────────────────────────

-- Step 4A: Restore the cash_in on all ghost-dedup rows
UPDATE treasury t
SET cash_in = ABS(eb.amount),
    description = REPLACE(
      t.description,
      ' [bank confirmation — not added to collected]',
      ' [BULK RESTORED ' || NOW()::date || ']'
    )
FROM egypt_bank_transactions eb
WHERE t.matched_bank_txn_id = eb.id
  AND COALESCE(t.cash_in, 0) = 0
  AND COALESCE(t.cash_out, 0) = 0
  AND t.is_bank_placeholder = false
  AND t.description LIKE '%[bank confirmation%'
  AND NOT EXISTS (
    SELECT 1 FROM treasury s
    WHERE s.id <> t.id
      AND s.linked_invoice_id = t.linked_invoice_id
      AND s.is_bank_placeholder = false
      AND COALESCE(s.cash_in, 0) > 0
      AND COALESCE(s.description, '') NOT LIKE '%[bank confirmation%'
  );

-- ─────────────────────────────────────────────────────────────
-- PART 4B — BULK INVOICE RECALC
-- Rebuilds total_collected + outstanding on EVERY affected invoice
-- based on the actual sum of its linked treasury cash_in rows.
-- Excludes placeholders and bank-confirmation-only rows (source of truth
-- matches recalcInvoiceCollected() in page.jsx).
-- Safe to run multiple times — fully idempotent.
-- ─────────────────────────────────────────────────────────────

-- Preview first: shows which invoices will change and by how much
WITH computed AS (
  SELECT
    i.id                                          AS invoice_id,
    i.order_number,
    i.customer_name,
    i.total_amount,
    i.total_collected                             AS stored_collected,
    i.outstanding                                 AS stored_outstanding,
    COALESCE(SUM(t.cash_in), 0)                   AS real_collected_raw,
    LEAST(
      COALESCE(SUM(t.cash_in), 0),
      i.total_amount
    )                                             AS new_collected,
    GREATEST(
      i.total_amount - LEAST(COALESCE(SUM(t.cash_in), 0), i.total_amount),
      0
    )                                             AS new_outstanding
  FROM invoices i
  LEFT JOIN treasury t ON t.linked_invoice_id = i.id
    AND COALESCE(t.cash_in, 0) > 0
    AND COALESCE(t.is_bank_placeholder, false) = false
    AND COALESCE(t.description, '') NOT LIKE '%[bank confirmation%'
  GROUP BY i.id, i.order_number, i.customer_name, i.total_amount, i.total_collected, i.outstanding
)
SELECT
  invoice_id,
  order_number,
  customer_name,
  total_amount,
  stored_collected,
  new_collected,
  (new_collected - stored_collected) AS collected_delta,
  stored_outstanding,
  new_outstanding
FROM computed
WHERE ABS(stored_collected - new_collected) > 0.01     -- only rows that will actually change
   OR ABS(stored_outstanding - new_outstanding) > 0.01
ORDER BY ABS(new_collected - stored_collected) DESC
LIMIT 100;

-- Execute the recalc (bulk UPDATE).
-- This touches every invoice whose collected doesn't match its real treasury sum.
UPDATE invoices i
SET total_collected = sub.new_collected,
    outstanding     = sub.new_outstanding,
    updated_at      = NOW()
FROM (
  SELECT
    i2.id                                         AS invoice_id,
    LEAST(
      COALESCE(SUM(t.cash_in), 0),
      i2.total_amount
    )                                             AS new_collected,
    GREATEST(
      i2.total_amount - LEAST(COALESCE(SUM(t.cash_in), 0), i2.total_amount),
      0
    )                                             AS new_outstanding
  FROM invoices i2
  LEFT JOIN treasury t ON t.linked_invoice_id = i2.id
    AND COALESCE(t.cash_in, 0) > 0
    AND COALESCE(t.is_bank_placeholder, false) = false
    AND COALESCE(t.description, '') NOT LIKE '%[bank confirmation%'
  GROUP BY i2.id, i2.total_amount
) sub
WHERE i.id = sub.invoice_id
  AND (
    ABS(i.total_collected - sub.new_collected) > 0.01
    OR ABS(i.outstanding - sub.new_outstanding) > 0.01
  );

-- Verify: these should all return zero rows / zero discrepancies
SELECT
  COUNT(*) AS invoices_out_of_sync
FROM invoices i
LEFT JOIN (
  SELECT linked_invoice_id, SUM(cash_in) AS real_collected
  FROM treasury
  WHERE COALESCE(cash_in, 0) > 0
    AND COALESCE(is_bank_placeholder, false) = false
    AND COALESCE(description, '') NOT LIKE '%[bank confirmation%'
  GROUP BY linked_invoice_id
) s ON s.linked_invoice_id = i.id
WHERE ABS(i.total_collected - LEAST(COALESCE(s.real_collected, 0), i.total_amount)) > 0.01;

-- Headline number: total EGP restored to treasury + correctly counted in invoices
SELECT
  COUNT(*)                                      AS rows_restored,
  SUM(cash_in)                                  AS total_egp_restored
FROM treasury
WHERE description LIKE '%[BULK RESTORED%';

-- ─────────────────────────────────────────────────────────────
-- PART 5 — PREVENT FUTURE DUPLICATE PLACEHOLDERS
-- Optional unique constraint: can't have two placeholders for
-- same amount + same day + same order_number.
-- Commented out by default — enable after you've cleaned existing dupes.
-- ─────────────────────────────────────────────────────────────
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_unique_placeholder
-- ON treasury(transaction_date, expected_amount, order_number)
-- WHERE is_bank_placeholder = true;
