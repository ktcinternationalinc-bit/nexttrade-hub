-- ============================================================
-- s38 — confirmed_not_duplicate flag on treasury
-- ============================================================
--
-- Why this exists:
--   When a user knowingly saves a transaction that looks like a duplicate
--   (same date + amount + description) — e.g. a customer pays the same
--   weekly amount on the same day, or two identical fuel purchases on the
--   same day — the v55.41 duplicate-confirmation modal asks them to
--   confirm. When they confirm, we want to remember that they made that
--   call so the AI accounting auditor doesn't keep flagging the same
--   row over and over as a "suspected duplicate."
--
-- This migration is OPTIONAL but RECOMMENDED:
--   • Optional, because dbInsert.js auto-strips unknown columns and
--     retries — so v55.41 saves work even if this migration isn't run.
--   • Recommended, because without the column, the auditor will keep
--     showing the same false-positive duplicate warning on every audit.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

ALTER TABLE treasury
  ADD COLUMN IF NOT EXISTS confirmed_not_duplicate BOOLEAN NOT NULL DEFAULT FALSE;

-- Comment for future Maxes / future developers reading the schema:
COMMENT ON COLUMN treasury.confirmed_not_duplicate IS
  'TRUE when a user explicitly confirmed (via the v55.41 duplicate modal) '
  'that this row is NOT a duplicate of an existing same-date+amount+description '
  'row, even though it looks identical. The AI accounting auditor uses this to '
  'suppress false-positive duplicate warnings on legitimate repeat payments.';

-- Verify the column landed:
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'treasury'
  AND column_name = 'confirmed_not_duplicate';
