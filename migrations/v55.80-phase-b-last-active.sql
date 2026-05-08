-- ============================================================
-- v55.80 PHASE-B+ migration — last_active + presence dedup support
-- May 8 2026 — per Max's feedback
--
-- WHAT THIS DOES (plain language):
-- 1. Adds a new column `last_active` to user_sessions. Today the system
--    only tracks "tab was open" (last_seen). This adds a separate column
--    that updates only when the user actually does something (clicks,
--    types, scrolls). That way we can tell "tab open all night" apart
--    from "actually working."
-- 2. Adds an index that helps dedup overlapping sessions when a user
--    has two browser tabs open at the same time.
--
-- SAFE TO RUN MULTIPLE TIMES — uses IF NOT EXISTS guards.
-- NO DATA LOSS — only adds columns, doesn't change existing data.
-- ============================================================

-- 1. Add last_active timestamp column (nullable; old rows have NULL,
--    that's fine — calc layer falls back to last_seen if NULL).
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS last_active timestamptz NULL;

COMMENT ON COLUMN user_sessions.last_active IS
  'Last user-input timestamp (mouse/key/touch/scroll). NULL = legacy session. Fallback to last_seen for hours calc.';

-- 2. Index for the dedup query (find all sessions for one user ordered by login_at).
-- Already covered by an existing user_id+date index in most deployments,
-- but make explicit:
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_login
  ON user_sessions (user_id, login_at);

-- 3. Backfill: copy last_seen → last_active for existing rows so the
-- presence calc has SOMETHING to compute on (otherwise pre-migration
-- sessions show 0 active hours). This is a one-time safe write.
UPDATE user_sessions
   SET last_active = last_seen
 WHERE last_active IS NULL
   AND last_seen IS NOT NULL;

-- ============================================================
-- VALIDATION QUERIES (read-only, safe to run anytime)
-- ============================================================

-- How many sessions have last_active populated?
-- SELECT count(*) FILTER (WHERE last_active IS NOT NULL) AS with_active,
--        count(*) FILTER (WHERE last_active IS NULL) AS without_active,
--        count(*) AS total
-- FROM user_sessions;

-- For one user in one day, how do last_seen vs last_active compare?
-- SELECT user_id, date, login_at, last_seen, last_active, logout_at,
--        EXTRACT(EPOCH FROM (last_active - login_at))/60 AS active_minutes,
--        EXTRACT(EPOCH FROM (last_seen - login_at))/60 AS open_minutes
-- FROM user_sessions
-- WHERE user_id = '<some-uuid>'
--   AND date = '2026-05-08'
-- ORDER BY login_at;
