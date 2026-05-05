-- ============================================================
-- s31_phone_routing_user_columns.sql
-- v55 Phone Phase B — Per-user routing preferences
-- Date: 2026-04-26
--
-- Adds columns to the `users` table so each team member can be reached
-- in different ways. The admin sets these in Settings → Phone.
--
-- Routing modes:
--   'browser'        — only ring browser (cheap; only catches when logged in)
--   'cell'           — only forward to cell (works anywhere, costs intl. rate)
--   'browser_cell'   — ring browser first, fall back to cell (recommended)
--
-- Cost note for 'browser_cell' going to Egypt: when browser doesn't answer
-- in 15 sec, Twilio dials the cell. Egypt cell rates are ~$0.16-0.22/min.
-- Forwarding only happens if browser was offline / didn't answer.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS forwarding_number TEXT,
  ADD COLUMN IF NOT EXISTS phone_routing TEXT NOT NULL DEFAULT 'browser_cell',
  ADD COLUMN IF NOT EXISTS phone_vacation_mode BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.forwarding_number   IS 'E.164 phone for cell forwarding (e.g. +20100123456) — Phase B';
COMMENT ON COLUMN users.phone_routing       IS 'browser | cell | browser_cell — how incoming calls reach this user (Phase B)';
COMMENT ON COLUMN users.phone_vacation_mode IS 'When true, all forwarding off; calls go straight to voicemail (Phase B)';

-- Verify
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'users'
   AND column_name IN ('forwarding_number', 'phone_routing', 'phone_vacation_mode')
 ORDER BY column_name;
