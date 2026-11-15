-- ============================================================
-- s32_phone_rls_policies.sql
-- v55 Phase B — Row Level Security on phone_* tables
--                + UNIQUE INDEXES for race-safe upserts
-- Date: 2026-04-26 (RLS) / 2026-04-27 (indexes added)
--
-- WHY THIS EXISTS:
-- 1. RLS — Without it, anyone who's logged into the Supabase JS client
--    can query phone_numbers / phone_calls / phone_voicemails /
--    phone_recordings directly, bypassing API-route auth checks.
--
-- 2. Unique indexes — The voicemail-record and recording-callback
--    webhooks fire TWICE for the same recording (once for the dial
--    action, once for recordingStatusCallback). The API code uses
--    upsert with onConflict='twilio_recording_sid' to prevent dupe
--    rows. That requires a UNIQUE constraint on the column. Without
--    it, two simultaneous webhook hits can both insert.
--
-- This migration enables RLS + adds the unique indexes:
--   • Service role (used by API routes) → full access (no change)
--   • Regular logged-in users → only their own data
--   • Admins/super_admins → see everything
--
-- The policies use a helper function `is_admin_user()` that checks the
-- current user's role from the users table.
--
-- IMPORTANT: API routes that use SUPABASE_SERVICE_ROLE_KEY bypass RLS
-- entirely, so this doesn't break the webhook/admin flows. It only
-- restricts direct Supabase JS client access from the browser.
--
-- Safe to re-run.
-- ============================================================

-- =============================================================
-- 0. Unique indexes for race-safe upserts
-- =============================================================
-- These two indexes back the onConflict='twilio_recording_sid' upsert
-- in /api/phone/voicemail-record and /api/phone/recording-callback.
-- Without them, Twilio's two-fire pattern (action callback +
-- recordingStatusCallback for the same RecordingSid) can race and
-- create duplicate rows.
--
-- We use IF NOT EXISTS so re-running is safe.
-- We use a partial index (WHERE column IS NOT NULL) so legacy rows
-- with NULL recording SIDs (from before this column existed) don't
-- block the index creation.
CREATE UNIQUE INDEX IF NOT EXISTS phone_voicemails_recording_sid_uniq
  ON phone_voicemails (twilio_recording_sid)
  WHERE twilio_recording_sid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS phone_recordings_recording_sid_uniq
  ON phone_recordings (twilio_recording_sid)
  WHERE twilio_recording_sid IS NOT NULL;

-- =============================================================
-- Helper: is the calling user an admin?
-- =============================================================
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
  );
$$;

-- =============================================================
-- 1. phone_numbers — admin can see + edit; everyone can read
-- =============================================================
ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_numbers_select ON phone_numbers;
CREATE POLICY phone_numbers_select ON phone_numbers FOR SELECT
  USING (auth.uid() IS NOT NULL);  -- any logged-in user can read

DROP POLICY IF EXISTS phone_numbers_modify ON phone_numbers;
CREATE POLICY phone_numbers_modify ON phone_numbers FOR ALL
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- =============================================================
-- 2. phone_calls — see only your own; admins see all
-- =============================================================
ALTER TABLE phone_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_calls_select ON phone_calls;
CREATE POLICY phone_calls_select ON phone_calls FOR SELECT
  USING (
    auth.uid() = user_id
    OR is_admin_user()
  );

DROP POLICY IF EXISTS phone_calls_insert ON phone_calls;
CREATE POLICY phone_calls_insert ON phone_calls FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS phone_calls_update ON phone_calls;
CREATE POLICY phone_calls_update ON phone_calls FOR UPDATE
  USING (auth.uid() = user_id OR is_admin_user())
  WITH CHECK (auth.uid() = user_id OR is_admin_user());

-- Delete: admin only
DROP POLICY IF EXISTS phone_calls_delete ON phone_calls;
CREATE POLICY phone_calls_delete ON phone_calls FOR DELETE
  USING (is_admin_user());

-- =============================================================
-- 3. phone_voicemails — see only assigned to you; admins see all
-- =============================================================
ALTER TABLE phone_voicemails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_voicemails_select ON phone_voicemails;
CREATE POLICY phone_voicemails_select ON phone_voicemails FOR SELECT
  USING (
    auth.uid() = assigned_to
    OR is_admin_user()
  );

DROP POLICY IF EXISTS phone_voicemails_update ON phone_voicemails;
CREATE POLICY phone_voicemails_update ON phone_voicemails FOR UPDATE
  USING (auth.uid() = assigned_to OR is_admin_user())
  WITH CHECK (auth.uid() = assigned_to OR is_admin_user());

DROP POLICY IF EXISTS phone_voicemails_delete ON phone_voicemails;
CREATE POLICY phone_voicemails_delete ON phone_voicemails FOR DELETE
  USING (is_admin_user());

-- INSERT: only via service role (webhooks). No browser-direct insert.
-- (No insert policy = inserts blocked for regular users; service_role bypasses.)

-- =============================================================
-- 4. phone_recordings — see only via the parent call's user_id
-- =============================================================
ALTER TABLE phone_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_recordings_select ON phone_recordings;
CREATE POLICY phone_recordings_select ON phone_recordings FOR SELECT
  USING (
    is_admin_user()
    OR call_id IN (
      SELECT id FROM phone_calls WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS phone_recordings_modify ON phone_recordings;
CREATE POLICY phone_recordings_modify ON phone_recordings FOR ALL
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- =============================================================
-- Verification
-- =============================================================
SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('phone_numbers', 'phone_calls', 'phone_voicemails', 'phone_recordings')
 ORDER BY tablename;
-- Should show rowsecurity = true on all 4 rows
