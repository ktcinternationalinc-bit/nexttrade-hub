-- ============================================================
-- v55.59 — system_tickets table (idempotent setup + repair)
--
-- This fixes "System Tickets tab shows nothing" / "+ New System Ticket
-- button does nothing" — both caused by the underlying table either
-- not existing OR missing columns the component needs.
--
-- Run once in Supabase SQL Editor. Safe to re-run; everything is
-- IF NOT EXISTS / ON CONFLICT DO NOTHING / column-add-if-missing.
-- ============================================================

-- 1. Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS system_tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_number TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'bug',
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT DEFAULT 'Open',
  assigned_to UUID,
  claude_review_requested BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_notes TEXT
);

-- 2. Add any missing columns to an EXISTING table (safe if table was
-- created by an older migration that didn't have these columns).
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS ticket_number TEXT;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'bug';
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Open';
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_review_requested BOOLEAN DEFAULT FALSE;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
-- v55.65 — Claude-fix tracking + retest workflow columns
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_last_fixed_at TIMESTAMPTZ;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_last_read_at TIMESTAMPTZ;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_session_id TEXT;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_fix_notes TEXT;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS claude_fixed_in_build_version TEXT;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS needs_retest BOOLEAN DEFAULT FALSE;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_completed_at TIMESTAMPTZ;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_completed_by UUID;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_outcome TEXT;
ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS retest_notes TEXT;

-- 3. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_system_tickets_status ON system_tickets(status);
CREATE INDEX IF NOT EXISTS idx_system_tickets_created_at ON system_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_tickets_claude_flag ON system_tickets(claude_review_requested) WHERE claude_review_requested = TRUE;

-- 4. Row-level security — same pattern as other tables: enable RLS,
-- then add a permissive policy so the app's anon/service-role keys can
-- read/write. Tighten later if needed.
DO $$ BEGIN ALTER TABLE system_tickets ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all system_tickets" ON system_tickets FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Sanity check — show count after running so you can confirm
SELECT COUNT(*) AS existing_tickets FROM system_tickets;
