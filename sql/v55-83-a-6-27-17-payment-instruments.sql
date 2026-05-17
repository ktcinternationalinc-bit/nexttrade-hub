-- v55.83-A.6.27.17 (Max May 17 2026) — Payment Instruments / Scheduled Receivables
--
-- Extends the existing `checks` table to support both checks AND promissory
-- notes as a unified "instrument" record. Per Max's spec: do NOT rename the
-- table (would break 34+ code references); just add columns. Existing rows
-- get sensible defaults so the UI keeps working without backfill.
--
-- THE FIVE NON-NEGOTIABLE RULES (also enforced in code by Phase 1 tests):
--   1. Entering an instrument NEVER writes to treasury.
--   2. Entering an instrument NEVER changes invoice.total_collected.
--   3. Entering an instrument NEVER changes safe or bank balance.
--   4. The recalc doesn't read instruments — it reads treasury only.
--   5. The popup is a LINK, not a CREATE. Stamps source_check_id on the
--      treasury row the accountant was already entering. Never inserts an
--      extra row.
--
-- This migration is ADDITIVE — no existing column changes, no DROP, no data
-- migration that could lose information. Safe to run multiple times (uses
-- IF NOT EXISTS guards).
--
-- Run this in Supabase SQL editor BEFORE deploying the v55.83-A.6.27.17 code.

-- ── 1. Instrument type column (default 'check' preserves existing rows) ──
ALTER TABLE checks
  ADD COLUMN IF NOT EXISTS instrument_type text NOT NULL DEFAULT 'check'
  CHECK (instrument_type IN ('check', 'promissory_note', 'other'));

-- ── 2. Extended status column ──
-- Today's status values: 'pending', 'collected', 'uncollected', 'bounced'
-- We're adding: 'deposited', 'cleared', 'cancelled', 'replaced'
-- Mapping: existing 'collected' rows are treated as 'cleared' at read time
-- via a compatibility view (handled in code, not SQL). The status column
-- itself is left as text — no enum constraint added, so existing rows
-- continue to validate.

-- ── 3. Issue date (separate from due date) ──
ALTER TABLE checks ADD COLUMN IF NOT EXISTS issue_date date;

-- ── 4. Attachment URL (photo of the check/promissory note) ──
-- Phase 3 will use this. For now just the column.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS attachment_url text;

-- ── 5. Audit columns ──
-- v55.83-A.6.27.19 (code review fix): created_at and updated_at are
-- NULLABLE. Setting NOT NULL DEFAULT now() on an existing table would
-- backfill EVERY existing row's created_at to the moment the migration
-- runs — making every legacy check appear to have been created at
-- migration time. That's a lie. New rows get now() via the column
-- default; legacy rows keep NULL until they're updated.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE checks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ── 6. Replacement chain (for bounce/replace workflow) ──
-- When a check bounces and is replaced by a new instrument, the OLD
-- instrument's replaced_by_id points to the NEW instrument's id. Forms
-- a linked list backward in time.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS replaced_by_id uuid REFERENCES checks(id) ON DELETE SET NULL;

-- ── 7. Bounce reason (text — why did it bounce) ──
ALTER TABLE checks ADD COLUMN IF NOT EXISTS bounce_reason text;

-- ── 8. Index for cash-flow forecast queries ──
-- The dashboard widget will query "instruments due in next N days". Pre-index
-- to keep that fast even when the table grows.
CREATE INDEX IF NOT EXISTS idx_checks_due_date_status
  ON checks (due_date, status)
  WHERE status IN ('pending', 'deposited');

-- ── 9. Index for popup lookup ──
-- Treasury entry popup queries "pending instruments on this invoice with
-- matching amount." Index (invoice_id, status) for fast lookup.
CREATE INDEX IF NOT EXISTS idx_checks_invoice_status
  ON checks (invoice_id, status);

-- ── 10. Trigger to keep updated_at fresh on every UPDATE ──
CREATE OR REPLACE FUNCTION update_checks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_checks_updated_at ON checks;
CREATE TRIGGER trigger_checks_updated_at
BEFORE UPDATE ON checks
FOR EACH ROW
EXECUTE FUNCTION update_checks_updated_at();

-- ── 11. Sanity check ──
-- After running this you should see all the new columns:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'checks' ORDER BY ordinal_position;
--
-- And the index list:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'checks';
