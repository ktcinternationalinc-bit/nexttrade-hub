-- v55.83-A.6.27.13 — Global Invoice Reconciliation Audit
--
-- Finds every invoice where the AMOUNT computed by recalcInvoiceCollected
-- (uses linked_invoice_id, UUID) DISAGREES with the AMOUNT that would
-- appear if you summed the rows the panel displays (uses order_number,
-- string).
--
-- Read-only. Run this to see the blast radius of the linkage drift issue.
-- A non-empty result means the problem in invoice 2330 likely affects
-- other orders too.

WITH inv_recalc AS (
  -- What recalcInvoiceCollected would compute right now (UUID-keyed)
  SELECT
    i.id AS inv_id,
    i.order_number,
    i.total_amount,
    i.total_collected AS stored_collected,
    SUM(CASE
          WHEN t.dedup_sibling_id IS NOT NULL THEN 0
          WHEN t.description LIKE '%[bank confirmation%' THEN 0
          WHEN t.is_bank_placeholder THEN 0
          WHEN t.needs_bank_match AND t.matched_bank_txn_id IS NULL THEN 0
          ELSE COALESCE(t.cash_in, 0) + COALESCE(t.bank_in, 0)
        END) AS confirmed_by_uuid,
    SUM(CASE
          WHEN t.dedup_sibling_id IS NOT NULL THEN 0
          WHEN t.description LIKE '%[bank confirmation%' THEN 0
          WHEN t.is_bank_placeholder THEN COALESCE(t.bank_in, t.expected_amount, 0)
          WHEN t.needs_bank_match AND t.matched_bank_txn_id IS NULL THEN COALESCE(t.bank_in, 0)
          ELSE 0
        END) AS pending_by_uuid
  FROM invoices i
  LEFT JOIN treasury t ON t.linked_invoice_id = i.id
  GROUP BY i.id, i.order_number, i.total_amount, i.total_collected
),
inv_panel AS (
  -- What the panel would display (order_number string match, panel filters
  -- out placeholders + dedup + confirm-markers)
  SELECT
    i.id AS inv_id,
    SUM(COALESCE(t.cash_in, 0) + COALESCE(t.bank_in, 0)) AS panel_visible_sum,
    COUNT(t.id) AS panel_visible_rows
  FROM invoices i
  LEFT JOIN treasury t
    ON t.order_number = i.order_number
   AND NOT t.is_bank_placeholder
   AND t.dedup_sibling_id IS NULL
   AND (t.description IS NULL OR t.description NOT LIKE '%[bank confirmation%')
  GROUP BY i.id
)
SELECT
  r.order_number,
  r.total_amount,
  r.stored_collected,
  r.confirmed_by_uuid,
  r.pending_by_uuid,
  r.confirmed_by_uuid + r.pending_by_uuid AS total_by_uuid,
  p.panel_visible_sum,
  ROUND(((r.confirmed_by_uuid + r.pending_by_uuid) - p.panel_visible_sum)::numeric, 2) AS uuid_minus_panel,
  p.panel_visible_rows,
  CASE
    WHEN ABS(((r.confirmed_by_uuid + r.pending_by_uuid) - p.panel_visible_sum)) >= 1
    THEN '⚠️ Recalc and panel disagree'
    WHEN ABS(r.stored_collected - LEAST(r.confirmed_by_uuid + r.pending_by_uuid, r.total_amount)) >= 1
    THEN '⚠️ Stored collected stale (re-run Fix Links)'
    ELSE 'OK'
  END AS status
FROM inv_recalc r
JOIN inv_panel p ON p.inv_id = r.inv_id
WHERE
  -- Show only invoices with a discrepancy of at least 1 EGP
  ABS(((r.confirmed_by_uuid + r.pending_by_uuid) - p.panel_visible_sum)) >= 1
  OR ABS(r.stored_collected - LEAST(r.confirmed_by_uuid + r.pending_by_uuid, r.total_amount)) >= 1
ORDER BY ABS(((r.confirmed_by_uuid + r.pending_by_uuid) - p.panel_visible_sum)) DESC
LIMIT 200;
