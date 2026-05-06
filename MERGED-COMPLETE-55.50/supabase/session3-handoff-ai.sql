-- ============================================================
-- KTC NextTrade Hub — Session 3 SQL migration
-- Date: April 20, 2026
-- R6: Automated Claude handoff pipeline + ET timezone hardening
--
-- What this does, in plain language:
-- 1. Adds an et_date column to user_sessions so the AI can tell
--    "yesterday" correctly in New York time instead of UTC.
-- 2. Creates a tiny claude_handoff_log table so we can see every time
--    Claude pulled tickets and what it did.
-- 3. Adds system_tickets.claude_review_requested flag — when you toggle
--    "Let Claude fix this" on a ticket, we set that to true. Claude reads
--    it next handoff.
-- ============================================================

-- ============================================================
-- STEP 1 — BACKUPS
-- ============================================================
DROP TABLE IF EXISTS user_sessions_backup_session3_20260420;
CREATE TABLE user_sessions_backup_session3_20260420 AS SELECT * FROM user_sessions;

-- tickets backup may or may not exist depending on table name. Try both safely.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tickets') THEN
    DROP TABLE IF EXISTS tickets_backup_session3_20260420;
    EXECUTE 'CREATE TABLE tickets_backup_session3_20260420 AS SELECT * FROM tickets';
  END IF;
END $$;


-- ============================================================
-- STEP 2 — user_sessions ET date correction
-- Old rows were stored with UTC date. New-York login at 10pm ET = 2am UTC
-- next day = stored as "tomorrow" = "you weren't here yesterday" bug.
--
-- Fix: add a GENERATED column et_date that's always correct, then ALSO
-- backfill the date column so old queries work.
-- ============================================================
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS et_date DATE
  GENERATED ALWAYS AS ((login_at AT TIME ZONE 'America/New_York')::date) STORED;

CREATE INDEX IF NOT EXISTS idx_user_sessions_et_date ON user_sessions(user_id, et_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_login_at ON user_sessions(login_at DESC);

-- Backfill: rewrite the `date` column to match ET, not UTC, for old rows.
-- Only update if there's a divergence (UTC date != ET date) — harmless for
-- correct rows.
UPDATE user_sessions
SET date = (login_at AT TIME ZONE 'America/New_York')::date
WHERE date IS DISTINCT FROM (login_at AT TIME ZONE 'America/New_York')::date;


-- ============================================================
-- STEP 3 — system_tickets Claude-review pipeline
-- Adds flags to the existing system_tickets table (which is separate from
-- regular "tickets" — system_tickets is the internal bug queue).
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_tickets') THEN
    -- Request Claude to review on next handoff
    EXECUTE 'ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_review_requested BOOLEAN DEFAULT false';
    -- When Claude last read this ticket
    EXECUTE 'ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_last_read_at TIMESTAMPTZ';
    -- When Claude last updated/fixed this ticket
    EXECUTE 'ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_last_fixed_at TIMESTAMPTZ';
    -- Which session ID Claude assigned when working on this
    EXECUTE 'ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_session_id TEXT';
    -- Free-text notes Claude writes when fixing (diagnosis, fix summary)
    EXECUTE 'ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_fix_notes TEXT';
    CREATE INDEX IF NOT EXISTS idx_system_tickets_claude_review
      ON system_tickets(claude_review_requested, status)
      WHERE claude_review_requested = true;
  END IF;
END $$;


-- ============================================================
-- STEP 4 — claude_handoff_log table
-- Every time Claude hits /api/claude-handoff, a row is written here.
-- You can see in Admin what Claude did, when, for how long.
-- ============================================================
CREATE TABLE IF NOT EXISTS claude_handoff_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('pull','update','comment','fix','reopen')),
  ticket_id UUID,
  payload JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_claude_handoff_log_created ON claude_handoff_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claude_handoff_log_session ON claude_handoff_log(session_id);
CREATE INDEX IF NOT EXISTS idx_claude_handoff_log_ticket  ON claude_handoff_log(ticket_id) WHERE ticket_id IS NOT NULL;

ALTER TABLE claude_handoff_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "auth_read_chl" ON claude_handoff_log FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Writes only from service role (Claude's API route) — intentional, no "auth_write"


-- ============================================================
-- STEP 4.5 — Voice preference + session-persistent greeting state
-- (Added with voice UX rebuild — "Hey Bob")
--
-- Why on user_sessions and not users:
--   - voice_enabled is a per-user preference → users table
--   - greeted_at is per-LOGIN-SESSION (when you log out and back in you
--     get a fresh greeting) → user_sessions
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_language  TEXT;

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS greeted_at TIMESTAMPTZ;
-- When user logs out manually, this gets stamped. Helps "is user still active"
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS logout_at  TIMESTAMPTZ;


-- ============================================================
-- STEP 5 — ai_alerts table (Proactive Intelligence — AI v2)
-- The AI watches the data in the background and writes alerts here.
-- The morning briefing + AI assistant surfaces them proactively.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
    -- 'overdue_invoice', 'silent_customer', 'check_clearing_soon',
    -- 'shipment_at_risk', 'ticket_unusual_delay', 'unusual_pattern'
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  subject TEXT NOT NULL,
  body TEXT,
  related_entity_type TEXT, -- 'invoice','customer','check','shipment','ticket'
  related_entity_id UUID,
  confidence NUMERIC DEFAULT 0.75,
  recommendation TEXT,
  suggested_actions JSONB,
  dismissed_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_user_pending
  ON ai_alerts(target_user_id, severity, created_at DESC)
  WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_alerts_type ON ai_alerts(alert_type, created_at DESC);
-- Dedup: don't spam the same alert twice in 24h
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_alerts_unique
  ON ai_alerts(target_user_id, alert_type, related_entity_id, (date_trunc('day', created_at)));

ALTER TABLE ai_alerts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "auth_read_aia" ON ai_alerts FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "auth_write_aia" ON ai_alerts FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- STEP 7 — category_memory table (Sales auto-categorization)
--
-- Given a new invoice/sale, we look up which (category, subcategory)
-- this customer + description has historically been classified under,
-- and auto-apply the most-frequent one.
--
-- Populated three ways:
--   1. Trigger on invoices INSERT/UPDATE with category set → bump the
--      relevant keyword/customer counts.
--   2. Backfill script reads all categorized invoices on deploy.
--   3. Manual overrides from the Settings → Categories Editor UI.
-- ============================================================
CREATE TABLE IF NOT EXISTS category_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The signal that predicts the category:
  signal_type TEXT NOT NULL CHECK (signal_type IN ('customer','keyword','amount_bracket')),
  signal_value TEXT NOT NULL,        -- customer id, keyword, or bracket label
  category TEXT NOT NULL,
  subcategory TEXT,
  hit_count INT NOT NULL DEFAULT 1,  -- how many times this mapping was seen
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'observed',
    -- 'observed' (from past invoices), 'manual' (user set it in Settings),
    -- 'seed' (first-time deploy backfill)
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catmem_unique
  ON category_memory(signal_type, signal_value, category, COALESCE(subcategory, ''));
CREATE INDEX IF NOT EXISTS idx_catmem_signal
  ON category_memory(signal_type, signal_value);

ALTER TABLE category_memory ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "auth_read_cm" ON category_memory FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "auth_write_cm" ON category_memory FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- STEP 6 — VERIFY
-- ============================================================
SELECT 'user_sessions et_date' AS what,
       bool_or(column_name = 'et_date') AS has_et_date
FROM information_schema.columns
WHERE table_name = 'user_sessions';

SELECT 'system_tickets claude cols' AS what,
       bool_or(column_name = 'claude_review_requested') AS has_review_flag,
       bool_or(column_name = 'claude_fix_notes')        AS has_fix_notes
FROM information_schema.columns
WHERE table_name = 'system_tickets';

SELECT 'claude_handoff_log' AS what, COUNT(*) AS row_count FROM claude_handoff_log;
SELECT 'ai_alerts' AS what, COUNT(*) AS row_count FROM ai_alerts;

SELECT 'et_date backfill divergence' AS what,
       COUNT(*) AS rows_where_et_differs_from_utc
FROM user_sessions
WHERE date IS DISTINCT FROM (login_at AT TIME ZONE 'America/New_York')::date;

SELECT 'DONE ✅' AS step;


-- ============================================================
-- ROLLBACK (only if deploy breaks)
-- ============================================================
-- BEGIN;
--   TRUNCATE user_sessions;
--   INSERT INTO user_sessions SELECT * FROM user_sessions_backup_session3_20260420;
--   DROP TABLE IF EXISTS claude_handoff_log;
--   DROP TABLE IF EXISTS ai_alerts;
--   ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_review_requested;
--   ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_last_read_at;
--   ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_last_fixed_at;
--   ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_session_id;
--   ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_fix_notes;
--   ALTER TABLE user_sessions DROP COLUMN IF EXISTS et_date;
-- COMMIT;

-- Drop backup after ~1 week stability:
-- DROP TABLE user_sessions_backup_session3_20260420;
-- DROP TABLE IF EXISTS tickets_backup_session3_20260420;
