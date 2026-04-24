-- =====================================================================
-- AI MEMORY MIGRATION
-- Individualized per-employee AI memory + super-admin settings.
-- Date: April 19, 2026
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ai_memory_settings — super-admin controlled global rules
-- Singleton row. Only super-admin can write.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_memory_settings (
  id                          INTEGER PRIMARY KEY DEFAULT 1,
  auto_capture_enabled        BOOLEAN DEFAULT TRUE,
  capture_urgent              BOOLEAN DEFAULT TRUE,
  capture_meetings            BOOLEAN DEFAULT TRUE,
  capture_reminders           BOOLEAN DEFAULT TRUE,
  capture_notes               BOOLEAN DEFAULT TRUE,
  capture_follow_ups          BOOLEAN DEFAULT TRUE,
  default_note_retention_days INTEGER DEFAULT 30,
  cross_user_read             TEXT DEFAULT 'team_only',   -- 'disabled' | 'team_only' | 'unrestricted'
  morning_briefing_enabled    BOOLEAN DEFAULT TRUE,
  briefing_hour_local         INTEGER DEFAULT 8,          -- 0-23, local time hint
  max_memory_items_per_user   INTEGER DEFAULT 500,
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_by                  UUID,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Seed the singleton row if absent
INSERT INTO ai_memory_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2. ai_memory — per-user memory items
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_memory (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,               -- owner of this memory item
  content              TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('urgent', 'meeting', 'reminder', 'note', 'follow_up')),
  scope                TEXT DEFAULT 'private' CHECK (scope IN ('private', 'team', 'all')),
  target_user_id       UUID,                        -- set when memory relates to another employee
  source_ref           UUID,
  source_table         TEXT,                        -- 'tickets' | 'invoices' | 'crm_leads' | 'calendar_events' | 'chat'
  extracted_from_chat  TEXT,                        -- snippet from the user's chat that triggered this
  expires_at           TIMESTAMPTZ,
  acknowledged_at      TIMESTAMPTZ,
  acknowledged_by      UUID,
  dismissed_at         TIMESTAMPTZ,
  dismissed_by         UUID,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  created_by           UUID,
  auto_captured        BOOLEAN DEFAULT FALSE,
  notes                TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_memory_user_active
  ON ai_memory(user_id)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_memory_target_user
  ON ai_memory(target_user_id)
  WHERE dismissed_at IS NULL AND target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_memory_type_active
  ON ai_memory(type, user_id)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_memory_expires
  ON ai_memory(expires_at)
  WHERE expires_at IS NOT NULL AND dismissed_at IS NULL;


-- ---------------------------------------------------------------------
-- 3. RLS policies
-- Permissive — the API routes use the service role key anyway, so this
-- is belt-and-suspenders. Anyone signed in can read their own + targeted.
-- Super-admin check is enforced in /api/ask and in the settings UI
-- (client-side + server-side).
-- ---------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE ai_memory ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ai_memory_settings ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "ai_memory_all_ops" ON ai_memory FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "ai_memory_settings_all_ops" ON ai_memory_settings FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------
-- SELECT 'ai_memory rows' AS what, COUNT(*) AS n FROM ai_memory
-- UNION ALL
-- SELECT 'ai_memory_settings rows', COUNT(*) FROM ai_memory_settings;
