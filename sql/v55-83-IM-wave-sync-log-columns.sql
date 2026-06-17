-- v55.83-IM — restore the Wave sync/push AUDIT TRAIL.
--
-- ──────────────────────────────────────────────────────────────────
-- WHAT THIS FIXES (plain English)
-- ──────────────────────────────────────────────────────────────────
-- The payment-push, scheduled-pull, and category-sync routes write audit rows
-- into wave_sync_log with two columns that the table NEVER HAD:
--   • wave_business_id   (which Wave business the action targeted)
--   • dry_run            (was this a dry-run or a real write?)
-- Because Supabase returns {error} without throwing and those inserts are
-- wrapped in try/catch, the failures were silent — so NO audit row was written
-- for any payment push / scheduled pull / category sync. For a money-handling
-- launch the audit trail must work. This adds the two missing columns
-- (idempotent) so those inserts succeed.
--
-- Also note: the import routes log with business_id + wave_record_id (the Wave
-- business id) and DO write successfully; the v55.83-IM UI filter change in
-- WaveSyncCenter.jsx stops hiding rows that have no wave_business_id so those
-- import rows become visible again.

ALTER TABLE wave_sync_log ADD COLUMN IF NOT EXISTS wave_business_id text;
ALTER TABLE wave_sync_log ADD COLUMN IF NOT EXISTS dry_run boolean DEFAULT false;

-- Fast lookup of a business's recent sync activity.
CREATE INDEX IF NOT EXISTS idx_wave_sync_log_wave_business
  ON wave_sync_log (wave_business_id, attempted_at DESC);

-- ──────────────────────────────────────────────────────────────────
-- VERIFY
-- ──────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='wave_sync_log' AND column_name IN ('wave_business_id','dry_run');
-- Expected: 2 rows.
--
-- After a payment push you should now see a row:
-- SELECT attempted_at, entity_type, action, success, wave_business_id, dry_run, error_message
-- FROM wave_sync_log ORDER BY attempted_at DESC LIMIT 20;

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT (only if needed)
-- ──────────────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_wave_sync_log_wave_business;
--   ALTER TABLE wave_sync_log DROP COLUMN IF EXISTS dry_run;
--   ALTER TABLE wave_sync_log DROP COLUMN IF EXISTS wave_business_id;
