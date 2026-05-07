-- ============================================================
-- v55.74 — s42_backups.sql
-- Periodic backups of business-critical tables.
--
-- Reported by Max May 7 2026: "Please make periodic backups of any
-- type of items that are crucial to our business such as tickets,
-- things like that, every once in a while, please including right now."
--
-- DESIGN:
--   - One row per backup snapshot
--   - data column is JSONB containing the full table dumps
--   - kind: 'manual' (button click), 'daily' (cron 4am ET), 'weekly'
--           (promoted daily on Sundays), 'monthly' (promoted weekly
--           on 1st of month)
--   - retention managed by /api/backup/snapshot at end of each run
--
-- ALL ACCESS IS SUPER_ADMIN ONLY at the application layer. RLS
-- requires authentication at the DB layer; the app filters down
-- to super_admin in /api/backup routes. Backups contain sensitive
-- data (treasury, invoices, customer details) — they MUST NOT be
-- listed or downloaded by anyone except super_admin.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual','daily','weekly','monthly')),
  triggered_by UUID,                 -- user id (null for cron)
  triggered_by_name TEXT,            -- denormalized for display
  tables_included TEXT[] DEFAULT ARRAY[]::TEXT[],
  row_counts JSONB DEFAULT '{}'::JSONB,
  size_bytes BIGINT DEFAULT 0,
  duration_ms INT DEFAULT 0,
  notes TEXT,
  pinned BOOLEAN DEFAULT FALSE,      -- if true, retention does not delete
  -- The actual snapshot. JSONB so it compresses well + is queryable.
  data JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_kind ON backups(kind, created_at DESC);

-- ============================================================
-- RLS — authentication required at DB layer; app enforces super_admin
-- ============================================================
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backups_select ON backups;
CREATE POLICY backups_select ON backups FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS backups_insert ON backups;
CREATE POLICY backups_insert ON backups FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS backups_update ON backups;
CREATE POLICY backups_update ON backups FOR UPDATE
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS backups_delete ON backups;
CREATE POLICY backups_delete ON backups FOR DELETE
  USING (auth.uid() IS NOT NULL);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Sanity check
-- ============================================================
SELECT
  '✅ backups table' AS check_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='backups') AS ok
UNION ALL
SELECT '✅ backups RLS policies (4)',
  (SELECT COUNT(*) FROM pg_policies WHERE tablename='backups') >= 4;

SELECT
  COUNT(*) AS backups_count,
  COUNT(*) FILTER (WHERE kind = 'manual') AS manual_count,
  COUNT(*) FILTER (WHERE kind = 'daily') AS daily_count,
  COUNT(*) FILTER (WHERE kind = 'weekly') AS weekly_count,
  COUNT(*) FILTER (WHERE kind = 'monthly') AS monthly_count,
  pg_size_pretty(COALESCE(SUM(size_bytes), 0)) AS total_size
FROM backups;
