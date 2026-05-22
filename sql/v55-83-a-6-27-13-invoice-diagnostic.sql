-- v55.83-A.6.27.13 (Max May 16 2026) — Invoice Reconciliation Diagnostic
--
-- Run this FOR ONE INVOICE to see the complete state. Replace 2330 with
-- the order number you're investigating.
--
-- Purpose: when the UI says "collected = X" but the linked-treasury panel
-- shows different rows, this query reveals every row that touches the
-- invoice from EVERY angle:
--   1. Direct UUID link (linked_invoice_id)
--   2. String link (order_number text match)
--   3. Bank statement matches (via matched_bank_txn_id)
--   4. Dedup siblings (mirror rows that should NOT double-count)
--   5. Placeholders (pending, expected_amount)
--
-- Output is split into clearly-labeled sections so you can spot mismatches.
-- Nothing in this script writes data — it's pure read.

-- ============================================================
-- SECTION 1: The invoice itself
-- ============================================================
SELECT 'INVOICE' AS section,
       id, order_number, customer_name,
       total_amount, total_collected, total_confirmed,
       total_pending_bank, total_written_off, overpayment_amount,
       outstanding, invoice_date, created_at
  FROM invoices
 WHERE order_number = '2330';   -- <<< CHANGE THIS

-- ============================================================
-- SECTION 2: Treasury rows linked by UUID (what the recalc sees)
-- ============================================================
SELECT 'TREASURY_BY_UUID' AS section,
       t.id, t.transaction_date, t.cash_in, t.cash_out, t.bank_in, t.bank_out,
       t.is_bank_placeholder, t.needs_bank_match, t.matched_bank_txn_id IS NOT NULL AS has_bank_match,
       t.dedup_sibling_id IS NOT NULL AS is_dedup_mirror,
       t.description LIKE '%[bank confirmation%' AS is_confirm_marker,
       t.expected_amount, t.order_number, t.linked_invoice_id,
       t.created_by, t.created_at
  FROM treasury t
  JOIN invoices i ON i.id = t.linked_invoice_id
 WHERE i.order_number = '2330'   -- <<< CHANGE THIS
 ORDER BY t.transaction_date, t.created_at;

-- ============================================================
-- SECTION 3: Treasury rows linked by STRING order_number (what the display shows)
-- ============================================================
SELECT 'TREASURY_BY_ORDER_NUMBER' AS section,
       t.id, t.transaction_date, t.cash_in, t.cash_out, t.bank_in, t.bank_out,
       t.is_bank_placeholder, t.needs_bank_match,
       t.dedup_sibling_id IS NOT NULL AS is_dedup_mirror,
       t.description LIKE '%[bank confirmation%' AS is_confirm_marker,
       t.expected_amount, t.order_number, t.linked_invoice_id,
       t.description
  FROM treasury t
 WHERE t.order_number = '2330'   -- <<< CHANGE THIS
 ORDER BY t.transaction_date, t.created_at;

-- ============================================================
-- SECTION 4: MISMATCH — rows linked by UUID but order_number is wrong/empty
-- (these inflate the recalc but DON'T appear in the panel)
-- ============================================================
SELECT 'INVISIBLE_TO_PANEL' AS section,
       t.id, t.transaction_date, t.cash_in, t.bank_in,
       t.order_number AS rows_order_number,
       i.order_number AS expected_order_number,
       t.description, t.linked_invoice_id
  FROM treasury t
  JOIN invoices i ON i.id = t.linked_invoice_id
 WHERE i.order_number = '2330'   -- <<< CHANGE THIS
   AND (t.order_number IS NULL OR t.order_number = '' OR t.order_number <> i.order_number);

-- ============================================================
-- SECTION 5: MISMATCH — rows with matching order_number but NO UUID link
-- (these show in the panel but DON'T count in the recalc)
-- ============================================================
SELECT 'INVISIBLE_TO_RECALC' AS section,
       t.id, t.transaction_date, t.cash_in, t.bank_in,
       t.order_number, t.linked_invoice_id, t.description
  FROM treasury t
 WHERE t.order_number = '2330'   -- <<< CHANGE THIS
   AND (t.linked_invoice_id IS NULL OR t.linked_invoice_id NOT IN (
        SELECT id FROM invoices WHERE order_number = '2330'   -- <<< CHANGE THIS
       ));

-- ============================================================
-- SECTION 6: Bank transactions referencing this order
-- ============================================================
SELECT 'EGYPT_BANK_TXNS' AS section,
       eb.id, eb.transaction_date, eb.amount, eb.matched_invoice_id IS NOT NULL AS matched,
       eb.matched_invoice_id, eb.description, eb.reference_number
  FROM egypt_bank_transactions eb
 WHERE eb.description ILIKE '%2330%'
    OR eb.reference_number ILIKE '%2330%'
    OR eb.matched_invoice_id IN (SELECT id FROM invoices WHERE order_number = '2330');

-- ============================================================
-- SECTION 7: COMPUTED TOTALS — what recalc would say
-- ============================================================
WITH inv AS (
  SELECT id, total_amount FROM invoices WHERE order_number = '2330'  -- <<< CHANGE THIS
), counted AS (
  SELECT
    SUM(CASE
          WHEN t.dedup_sibling_id IS NOT NULL THEN 0
          WHEN t.description LIKE '%[bank confirmation%' THEN 0
          WHEN t.is_bank_placeholder THEN 0  -- pending, counted separately
          WHEN t.needs_bank_match AND t.matched_bank_txn_id IS NULL THEN 0  -- pending
          ELSE COALESCE(t.cash_in, 0) + COALESCE(t.bank_in, 0)
        END) AS confirmed_sum,
    SUM(CASE
          WHEN t.dedup_sibling_id IS NOT NULL THEN 0
          WHEN t.description LIKE '%[bank confirmation%' THEN 0
          WHEN t.is_bank_placeholder THEN COALESCE(t.bank_in, t.expected_amount, 0)
          WHEN t.needs_bank_match AND t.matched_bank_txn_id IS NULL THEN COALESCE(t.bank_in, 0)
          ELSE 0
        END) AS pending_sum,
    COUNT(*) AS row_count
  FROM treasury t
  JOIN inv ON inv.id = t.linked_invoice_id
)
SELECT 'RECALC_SHOULD_SAY' AS section,
       inv.total_amount,
       counted.confirmed_sum,
       counted.pending_sum,
       counted.confirmed_sum + counted.pending_sum AS total_all,
       CASE WHEN counted.confirmed_sum + counted.pending_sum > inv.total_amount
            THEN counted.confirmed_sum + counted.pending_sum - inv.total_amount
            ELSE 0
       END AS overpayment_before_cap,
       counted.row_count
  FROM inv, counted;
