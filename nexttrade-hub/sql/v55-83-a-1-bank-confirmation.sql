-- ============================================================================
-- v55.83-A.1 — Invoice Bank-Confirmation Tracking
-- ============================================================================
-- Adds two new fields to the invoices table so the "Collected" amount can
-- be split into:
--   total_confirmed — money that's either physical (cash/safe) or matched
--                     against a real bank statement entry
--   total_pending   — money that was recorded as a bank payment but the
--                     bank statement hasn't yet confirmed (placeholder or
--                     unmatched bank_in row)
--
-- The existing total_collected = total_confirmed + total_pending. We keep
-- it for backward compatibility.
--
-- Also adds a flag column to treasury rows so we know they need bank
-- statement matching even if they were created via the "Add Payment" path
-- (Path A). Previously Path A's bank_transfer payments were considered
-- "trusted" immediately. v55.83-A.1 unifies both paths — every bank-channel
-- payment requires statement confirmation.
--
-- IDEMPOTENT — safe to re-run.

-- ============================================================================
-- INVOICES — confirmed/pending split
-- ============================================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_confirmed NUMERIC(18,4) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_pending_bank NUMERIC(18,4) DEFAULT 0;

-- ============================================================================
-- TREASURY — flag bank rows that still need matching
-- ============================================================================
-- needs_bank_match = TRUE means: this is a bank-channel payment row that has
-- not yet been linked to a real bank statement entry. It contributes to
-- total_pending_bank, not total_confirmed.
-- needs_bank_match = FALSE means: either (a) cash/safe channel (no bank
-- needed), (b) bank row that's been matched against a real statement entry,
-- or (c) the row IS a real bank statement entry.
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS needs_bank_match BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: existing treasury rows with bank_in > 0 that are NOT placeholders
-- and NOT matched should be flagged as needing match. Placeholders already
-- have is_bank_placeholder=TRUE which the helper treats the same way, but
-- we also flag any "trusted" bank_transfer rows from Path A.
UPDATE treasury
SET needs_bank_match = TRUE
WHERE (bank_in > 0 OR bank_out > 0)
  AND is_bank_placeholder = FALSE
  AND matched_bank_txn_id IS NULL
  AND needs_bank_match = FALSE;

-- ============================================================================
-- INDEXES — fast lookup of pending rows
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_invoices_pending_bank
  ON invoices (total_pending_bank)
  WHERE total_pending_bank > 0;

CREATE INDEX IF NOT EXISTS idx_treasury_needs_match
  ON treasury (needs_bank_match, linked_invoice_id)
  WHERE needs_bank_match = TRUE;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT
  COUNT(*) FILTER (WHERE total_pending_bank > 0) AS invoices_with_pending_bank,
  SUM(total_confirmed) AS total_confirmed_sum,
  SUM(total_pending_bank) AS total_pending_sum,
  SUM(total_collected) AS total_collected_sum
FROM invoices;

SELECT
  COUNT(*) FILTER (WHERE needs_bank_match) AS treasury_rows_awaiting_match,
  SUM(bank_in) FILTER (WHERE needs_bank_match) AS pending_bank_in_amount
FROM treasury;
