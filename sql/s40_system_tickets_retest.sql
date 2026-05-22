-- ============================================================
-- v55.65 — System tickets: build tracking + retest workflow
--
-- Adds the columns the v55.65 build needs for the workflow:
--   1. User flags ticket "Fix next session" (already exists: claude_review_requested)
--   2. Claude fixes it in the next build, marks it with the build version + test notes
--   3. Creator gets a retest card on their dashboard
--   4. Creator marks "retested OK" or "still broken"
--   5. Build highlights auto-include bugs fixed in that build
--
-- Run once in Supabase SQL Editor. Safe to re-run; everything is
-- ADD COLUMN IF NOT EXISTS.
-- ============================================================

-- 1. Build version a fix shipped in (e.g. 'v55.65')
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_fixed_in_build_version TEXT;

-- 2. Whether the creator should retest this ticket. Set to TRUE when Claude
-- marks a ticket as fixed; cleared when the creator marks it retested.
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS needs_retest BOOLEAN DEFAULT FALSE;

-- 3. Retest results
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_completed_at TIMESTAMPTZ;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_completed_by UUID;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_outcome TEXT
  CHECK (retest_outcome IS NULL OR retest_outcome IN ('passed', 'failed', 'partial'));
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_notes TEXT;

-- 4. Index so the dashboard "needs retest for me" query is cheap
CREATE INDEX IF NOT EXISTS idx_system_tickets_needs_retest
  ON system_tickets(needs_retest, created_by) WHERE needs_retest = TRUE;

-- 5. Index so the "what got fixed in build X" lookup is cheap
CREATE INDEX IF NOT EXISTS idx_system_tickets_fixed_in_build
  ON system_tickets(claude_fixed_in_build_version)
  WHERE claude_fixed_in_build_version IS NOT NULL;

-- 6. Sanity check
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE needs_retest = TRUE) AS waiting_for_retest,
  COUNT(*) FILTER (WHERE claude_fixed_in_build_version IS NOT NULL) AS ever_fixed_by_claude
FROM system_tickets;
