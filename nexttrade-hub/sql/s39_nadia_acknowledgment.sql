-- ============================================================
-- s39_nadia_acknowledgment.sql
-- v55.45 — Nadia acknowledgment for cross-team messages + reminders
-- ============================================================
--
-- Problem: Nadia would re-surface the same cross-team message every
-- single greeting, forever. e.g. Ahmad sends Max a note about being
-- available three hours a day → Max sees that note in EVERY single
-- Nadia greeting until the end of time.
--
-- Fix: Add acknowledged_at + acknowledged_by columns to ai_memory
-- (cross-team messages) and team_reminders. Once the user clicks
-- "Got it ✓" on a message, the ack columns are filled in and the
-- ask-route filters them out. If a NEW row is inserted (e.g. Ahmad
-- replies), it has its own ack columns set to NULL — so it surfaces
-- again, just like a fresh email.
--
-- Combined with the 7-day expiry filter in the ask-route, this means:
--   - Acknowledged messages: never resurface (until a new row is added)
--   - Unacknowledged messages: surface for 7 days, then auto-drop
--
-- Safe to run multiple times (IF NOT EXISTS everywhere).
-- ============================================================

-- ai_memory ack columns (cross-team relay messages)
DO $$ BEGIN
  ALTER TABLE ai_memory ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ai_memory ADD COLUMN IF NOT EXISTS acknowledged_by UUID;
EXCEPTION WHEN others THEN NULL; END $$;

-- team_reminders ack columns
DO $$ BEGIN
  ALTER TABLE team_reminders ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE team_reminders ADD COLUMN IF NOT EXISTS acknowledged_by UUID;
EXCEPTION WHEN others THEN NULL; END $$;

-- Indexes to make the ack-aware queries fast
CREATE INDEX IF NOT EXISTS ai_memory_target_ack_idx
  ON ai_memory (target_user_id, acknowledged_at, created_at);

CREATE INDEX IF NOT EXISTS team_reminders_target_ack_idx
  ON team_reminders (assigned_to, acknowledged_at, reminder_date);
