-- ============================================================
-- s29_phone_system.sql
-- v55 Phone System — Foundation tables for Twilio integration
-- Date: 2026-04-26
--
-- Adds the data layer for the phone system. Four new tables:
--
--   phone_numbers      — your KTC Twilio numbers + which team
--                         member each one is assigned to
--   phone_calls        — every call in/out (one row per call)
--   phone_voicemails   — voicemails left by callers
--   phone_recordings   — full call recordings (when on)
--
-- This file ALSO drops the legacy "call_logs" table if it
-- exists (the earlier scaffolding used that name). All call
-- logging now lives in phone_calls.
--
-- Run this BEFORE deploying the v55 phone code or the new API
-- routes will fail with "table does not exist" errors.
--
-- Safe to re-run (all CREATE statements use IF NOT EXISTS).
-- ============================================================

-- =============================================================
-- 1. phone_numbers — your Twilio numbers + who owns each
-- =============================================================
CREATE TABLE IF NOT EXISTS phone_numbers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Number in E.164 format, e.g. "+18886007096"
  phone_number TEXT NOT NULL UNIQUE,
  -- Display label, e.g. "Main shared line", "Bound Brook NJ"
  label TEXT,
  -- Type: "main" (shared queue) or "personal" (one team member)
  number_type TEXT NOT NULL DEFAULT 'personal',
  -- The team member this number rings/calls from. NULL = unassigned
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Whether this number records calls by default
  recording_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Whether voicemail is offered when no one answers
  voicemail_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- The Twilio Account SID this number lives under (for safety
  -- / audit if you ever have multiple Twilio accounts)
  twilio_account_sid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_assigned_to ON phone_numbers(assigned_to);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_number_type ON phone_numbers(number_type);

COMMENT ON TABLE phone_numbers IS 'KTC Twilio phone numbers and which team member each is assigned to (v55)';
COMMENT ON COLUMN phone_numbers.number_type IS 'main = shared queue line; personal = one team member''s direct line';
COMMENT ON COLUMN phone_numbers.recording_enabled IS 'When true, calls on this number are recorded (with disclaimer)';

-- =============================================================
-- 2. phone_calls — every inbound and outbound call
-- =============================================================
CREATE TABLE IF NOT EXISTS phone_calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Twilio's unique ID for this call (CallSid). Lets us look up
  -- the call in Twilio Console for support / refund / replay.
  twilio_call_sid TEXT UNIQUE,
  -- "inbound" (customer called us) or "outbound" (we called them)
  direction TEXT NOT NULL,
  -- The KTC number used (matches phone_numbers.phone_number)
  ktc_number TEXT NOT NULL,
  -- The customer's number (E.164 format)
  customer_number TEXT NOT NULL,
  -- If we matched the customer in our DB, link it
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  -- The team member who handled this call (if known)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Twilio's reported status: ringing, in-progress, completed,
  -- busy, no-answer, failed, canceled
  status TEXT NOT NULL DEFAULT 'unknown',
  -- Duration in seconds. Null until call completes.
  duration_seconds INTEGER,
  -- When the call started ringing
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When the call ended (or null if still in progress)
  ended_at TIMESTAMPTZ,
  -- CNAM lookup result (e.g. "Acme Corp"). Costs $0.01/inbound
  -- when enabled in Twilio. Null when not looked up.
  caller_name TEXT,
  -- Free-text notes the team member adds about the call
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_calls_customer_id ON phone_calls(customer_id);
CREATE INDEX IF NOT EXISTS idx_phone_calls_user_id     ON phone_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_phone_calls_started_at  ON phone_calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_calls_direction   ON phone_calls(direction);
CREATE INDEX IF NOT EXISTS idx_phone_calls_ktc_number  ON phone_calls(ktc_number);

COMMENT ON TABLE phone_calls IS 'One row per inbound or outbound phone call, linked to customer + team member where known (v55)';

-- =============================================================
-- 3. phone_voicemails — messages left by callers
-- =============================================================
CREATE TABLE IF NOT EXISTS phone_voicemails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Link back to the parent call
  call_id UUID REFERENCES phone_calls(id) ON DELETE CASCADE,
  -- Twilio's unique ID for this recording (RecordingSid)
  twilio_recording_sid TEXT UNIQUE,
  -- URL where Twilio hosts the audio file (MP3). Twilio retains
  -- recordings for the lifetime of the account unless deleted.
  recording_url TEXT,
  -- Length of the voicemail in seconds
  duration_seconds INTEGER,
  -- Whisper transcript (filled by /api/phone/transcribe-async).
  -- Null until transcription completes (1-2 minutes after VM ends).
  transcript TEXT,
  -- Pending → transcribing → completed | failed
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  -- Has the assigned user listened to / read this voicemail?
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  -- For quick filtering: which team member should see this?
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The customer (if matched)
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_voicemails_assigned_to ON phone_voicemails(assigned_to);
CREATE INDEX IF NOT EXISTS idx_phone_voicemails_customer_id ON phone_voicemails(customer_id);
CREATE INDEX IF NOT EXISTS idx_phone_voicemails_is_read     ON phone_voicemails(is_read);
CREATE INDEX IF NOT EXISTS idx_phone_voicemails_created_at  ON phone_voicemails(created_at DESC);

COMMENT ON TABLE phone_voicemails IS 'Voicemails with Whisper transcription, assigned to the right team member (v55)';

-- =============================================================
-- 4. phone_recordings — full call recordings (not voicemail)
-- =============================================================
CREATE TABLE IF NOT EXISTS phone_recordings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- The call being recorded
  call_id UUID REFERENCES phone_calls(id) ON DELETE CASCADE,
  twilio_recording_sid TEXT UNIQUE,
  recording_url TEXT,
  duration_seconds INTEGER,
  -- Whisper transcript of the full conversation
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_recordings_call_id ON phone_recordings(call_id);

COMMENT ON TABLE phone_recordings IS 'Full call recordings (legal disclaimer played at call start) with Whisper transcript (v55)';

-- =============================================================
-- 5. RLS policies — open by default for now, tighten in Phase B
-- =============================================================
-- Note: We're NOT enabling RLS yet because the API routes use
-- the service role key and need full access. Once the Settings
-- UI is built (Phase B), we'll add RLS policies that let team
-- members see their own assigned calls/voicemails only.

-- =============================================================
-- 6. Drop legacy call_logs table if present (replaced by phone_calls)
-- =============================================================
-- The earlier scaffolding wrote to "call_logs" — that table is
-- replaced by phone_calls. If you have legacy rows, copy them
-- over BEFORE running this drop.
--
-- To preview what will be dropped, uncomment:
-- SELECT COUNT(*) AS legacy_rows FROM call_logs;
--
-- Once you're ready to drop, uncomment this:
-- DROP TABLE IF EXISTS call_logs;

-- =============================================================
-- 7. Verification — should print 4 rows
-- =============================================================
SELECT table_name, table_type
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('phone_numbers', 'phone_calls', 'phone_voicemails', 'phone_recordings')
 ORDER BY table_name;
