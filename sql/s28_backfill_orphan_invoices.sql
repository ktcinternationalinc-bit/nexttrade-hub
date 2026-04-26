-- s28_backfill_orphan_invoices.sql
-- Apr 26 2026
-- =============================================================
-- ORPHAN INVOICE BACKFILL — REVIEW + AUTO-MATCH ORPHANS
-- =============================================================
-- Context:
--   Before v55.11 it was possible to create an invoice with
--   customer_id = NULL via the Treasury "Create Invoice + Save"
--   workflow. Those invoices show up in Sales but DON'T appear
--   under any customer's bucket on the Customers tab. This script
--   finds them and links what it can.
--
-- What this does:
--   STEP 1: Snapshot orphans into invoices_backup_orphans_20260426
--   STEP 2: Show count + total outstanding by orphan
--   STEP 3: Auto-match orphans whose customer_name EXACTLY matches
--           a customer (case-insensitive). Updates customer_id.
--   STEP 4: Show remaining orphans (no exact match) — manual review.
--           These usually need either a customer record created or
--           a name fix in the orphan invoice itself.
--
-- Safety:
--   • Backup table created first. Restore via TRUNCATE+INSERT if needed.
--   • Each step is independent — you can run them one at a time.
--   • No DELETE statements anywhere. Worst case is a wrong link, which
--     is reversible by setting customer_id back to NULL.
-- =============================================================

-- =============================================================
-- STEP 1: BACKUP
-- =============================================================
CREATE TABLE IF NOT EXISTS invoices_backup_orphans_20260426 AS
  SELECT * FROM invoices WHERE customer_id IS NULL;

SELECT
  'Backup snapshot created' AS status,
  COUNT(*) AS orphan_invoices_backed_up
FROM invoices_backup_orphans_20260426;

-- =============================================================
-- STEP 2: SUMMARY OF ORPHANS
-- =============================================================
-- Count + total outstanding owed by orphans.
-- Run this BEFORE step 3 to see the scale of the problem.
SELECT
  COUNT(*) AS total_orphan_invoices,
  COUNT(*) FILTER (WHERE customer_name IS NOT NULL AND TRIM(customer_name) != '') AS have_a_name,
  COUNT(*) FILTER (WHERE customer_name IS NULL OR TRIM(customer_name) = '') AS no_name_at_all,
  ROUND(SUM(total_amount)::numeric, 2) AS total_invoiced,
  ROUND(SUM(outstanding)::numeric, 2) AS total_outstanding,
  MIN(invoice_date) AS earliest_orphan,
  MAX(invoice_date) AS latest_orphan
FROM invoices
WHERE customer_id IS NULL;

-- Group orphans by customer_name to see how many UNIQUE missing customers
-- we're dealing with. If the same name appears 10 times, fixing it once
-- fixes 10 invoices.
SELECT
  TRIM(customer_name) AS name,
  COUNT(*) AS invoice_count,
  ROUND(SUM(total_amount)::numeric, 2) AS total_invoiced,
  ROUND(SUM(outstanding)::numeric, 2) AS total_outstanding
FROM invoices
WHERE customer_id IS NULL
  AND customer_name IS NOT NULL
  AND TRIM(customer_name) != ''
GROUP BY TRIM(customer_name)
ORDER BY invoice_count DESC, total_outstanding DESC
LIMIT 50;

-- =============================================================
-- STEP 3: AUTO-MATCH BY EXACT NAME (CASE-INSENSITIVE)
-- =============================================================
-- For each orphan whose customer_name matches a customer record
-- exactly (case-insensitive, trimmed), set customer_id.
--
-- Run this to see WHICH ones will be auto-matched (no changes yet):
SELECT
  i.id AS invoice_id,
  i.order_number,
  i.customer_name AS orphan_name,
  c.id AS matched_customer_id,
  c.name AS matched_customer_name,
  i.total_amount,
  i.outstanding
FROM invoices i
JOIN customers c
  ON LOWER(TRIM(c.name)) = LOWER(TRIM(i.customer_name))
WHERE i.customer_id IS NULL
  AND i.customer_name IS NOT NULL
  AND TRIM(i.customer_name) != ''
ORDER BY i.invoice_date DESC;

-- When you're satisfied with what step 3 will match, RUN THE BLOCK BELOW.
-- It applies the actual updates. Comment-toggle to enable:
/*
UPDATE invoices i
SET customer_id = c.id
FROM customers c
WHERE i.customer_id IS NULL
  AND i.customer_name IS NOT NULL
  AND TRIM(i.customer_name) != ''
  AND LOWER(TRIM(c.name)) = LOWER(TRIM(i.customer_name));

-- Verify the update:
SELECT
  COUNT(*) AS still_orphaned_after_automatch
FROM invoices
WHERE customer_id IS NULL;
*/

-- =============================================================
-- STEP 4: REMAINING ORPHANS — MANUAL REVIEW
-- =============================================================
-- After step 3, run this to see what's left. These need either:
--   (a) The customer doesn't exist yet → create the customer record
--       in the Customers tab, then re-run step 3.
--   (b) The name has a typo or variant → either fix the invoice's
--       customer_name in the Sales tab, or update one of the linked
--       customer's name aliases.
--   (c) The orphan has no name at all → open the invoice in Sales
--       and link it manually.
SELECT
  i.id AS invoice_id,
  i.order_number,
  COALESCE(NULLIF(TRIM(i.customer_name), ''), '(no name)') AS orphan_name,
  i.invoice_date,
  i.total_amount,
  i.outstanding,
  -- Suggest fuzzy-match candidates (substring contains)
  (
    SELECT STRING_AGG(c.name, ' | ')
    FROM customers c
    WHERE i.customer_name IS NOT NULL
      AND TRIM(i.customer_name) != ''
      AND (
        LOWER(c.name) LIKE '%' || LOWER(TRIM(i.customer_name)) || '%'
        OR LOWER(TRIM(i.customer_name)) LIKE '%' || LOWER(c.name) || '%'
      )
  ) AS fuzzy_candidates
FROM invoices i
WHERE i.customer_id IS NULL
ORDER BY i.invoice_date DESC;

-- =============================================================
-- ROLLBACK (if something went wrong)
-- =============================================================
-- To restore the orphan-invoice state from before step 3:
/*
UPDATE invoices
SET customer_id = NULL
WHERE id IN (SELECT id FROM invoices_backup_orphans_20260426);
*/
