-- v51.2 (Apr 24 2026) — Voice customization per user
--
-- Adds a JSONB column that stores each user's preferred ElevenLabs voice
-- plus delivery settings (stability / similarity / style / speaker boost).
-- Shape written by SettingsTab.jsx VoiceSettingsPanel:
--   {
--     voice_id: string | null,
--     stability: 0..1,
--     similarity: 0..1,
--     style: 0..1,
--     speaker_boost: boolean
--   }
--
-- Safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS voice_settings JSONB;

COMMENT ON COLUMN users.voice_settings IS
  'Per-user Nadia voice preferences (ElevenLabs voice_id + tuning). Shape: {voice_id, stability, similarity, style, speaker_boost}.';

-- Sanity check
SELECT 'users.voice_settings column exists' AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'voice_settings'
);
