-- ============================================================
-- s30_seed_ktc_phone_numbers.sql
-- Seed the 4 KTC Twilio numbers into phone_numbers
-- Date: 2026-04-26
--
-- RUN THIS AFTER s29_phone_system.sql.
--
-- These are Max's 4 numbers from the Apr 26 setup session:
--   • 1 toll-free main shared line: +1 888 600 7096
--   • 3 NJ local team lines:        +1 732 652 9850 (Bound Brook)
--                                    +1 732 800 5428 (Manasquan)
--                                    +1 732 810 0075 (Freehold)
--
-- Team member assignments (assigned_to) are left NULL — Max
-- will set those in the Settings → Phone Numbers UI in Phase B.
-- For now, all 4 numbers route to voicemail when called.
-- ============================================================

INSERT INTO phone_numbers (phone_number, label, number_type, recording_enabled, voicemail_enabled, twilio_account_sid)
VALUES
  ('+18886007096', 'KTC Main Line (toll-free)',  'main',     TRUE, TRUE, NULL),
  ('+17326529850', 'Team Line — Bound Brook NJ', 'personal', TRUE, TRUE, NULL),
  ('+17328005428', 'Team Line — Manasquan NJ',   'personal', TRUE, TRUE, NULL),
  ('+17328100075', 'Team Line — Freehold NJ',    'personal', TRUE, TRUE, NULL)
ON CONFLICT (phone_number) DO UPDATE
  SET label = EXCLUDED.label,
      number_type = EXCLUDED.number_type,
      updated_at = now();

-- Verify
SELECT phone_number, label, number_type, recording_enabled, voicemail_enabled, assigned_to
  FROM phone_numbers
 ORDER BY number_type, created_at;
