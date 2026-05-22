-- ============================================================
-- v55.65 — HR Desk: requests + complaints
--
-- Two tables. Requests are routine (vacation, equipment, schedule,
-- raise, training, etc.). Complaints are sensitive (interpersonal,
-- harassment, manager issue, safety). Both flow to super_admin.
--
-- Privacy rules enforced at the application layer:
--   - Submitter can always see/edit their own
--   - super_admin sees everything
--   - Regular admins see ONLY their assigned department's requests
--     (and NEVER complaints unless flagged "share with admin")
--
-- Run once in Supabase SQL Editor. Idempotent (safe to re-run).
-- ============================================================

-- ============================================================
-- 1. hr_requests — routine staff requests
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT,
  -- Submitter
  submitted_by UUID NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  -- What they're asking for
  category TEXT DEFAULT 'general'
    CHECK (category IN ('vacation','sick_leave','equipment','schedule_change',
                        'raise','promotion','training','expense','transfer',
                        'flexible_hours','remote_work','recognition','other','general')),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  -- Optional dates (for vacation, training, etc.)
  starts_on DATE,
  ends_on DATE,
  -- Status pipeline
  status TEXT DEFAULT 'submitted'
    CHECK (status IN ('submitted','under_review','approved','denied','more_info_needed','withdrawn','completed')),
  -- super_admin / admin response
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  decision_notes TEXT,
  -- Visibility (some requests can be marked "personal — only super_admin")
  visibility TEXT DEFAULT 'admin' CHECK (visibility IN ('admin','super_admin_only')),
  -- Audit
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

-- Index for fast inbox query
CREATE INDEX IF NOT EXISTS idx_hr_requests_status_priority ON hr_requests(status, priority, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_requests_submitter ON hr_requests(submitted_by, submitted_at DESC);

-- Auto-numbering trigger (HR-2026-0001 style)
CREATE OR REPLACE FUNCTION hr_request_autonumber()
RETURNS TRIGGER AS $$
DECLARE
  yr TEXT;
  seq INT;
BEGIN
  IF NEW.request_number IS NULL OR NEW.request_number = '' THEN
    yr := to_char(NOW() AT TIME ZONE 'America/New_York', 'YYYY');
    SELECT COALESCE(MAX(CAST(SUBSTRING(request_number FROM '\d+$') AS INT)), 0) + 1
      INTO seq
      FROM hr_requests
     WHERE request_number LIKE 'HR-' || yr || '-%';
    NEW.request_number := 'HR-' || yr || '-' || LPAD(seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hr_request_autonumber ON hr_requests;
CREATE TRIGGER trg_hr_request_autonumber
  BEFORE INSERT ON hr_requests
  FOR EACH ROW EXECUTE FUNCTION hr_request_autonumber();

-- ============================================================
-- 2. hr_complaints — sensitive complaints
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_number TEXT,
  submitted_by UUID NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  -- Anonymous to admins? (super_admin always sees who filed it)
  anonymous_to_admins BOOLEAN DEFAULT TRUE,
  -- Type
  category TEXT DEFAULT 'general'
    CHECK (category IN ('interpersonal_conflict','manager_issue','harassment',
                        'discrimination','safety','workload','pay_concern',
                        'work_environment','retaliation','process_issue','other','general')),
  -- Severity (self-reported by complainant)
  severity TEXT DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  title TEXT NOT NULL,
  description TEXT,
  -- Whom is it about (optional — they may decline to name)
  about_user_id UUID,
  about_team TEXT,
  -- super_admin response
  status TEXT DEFAULT 'submitted'
    CHECK (status IN ('submitted','investigating','resolved','dismissed','escalated','withdrawn')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  -- Audit
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_complaints_status ON hr_complaints(status, severity, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_complaints_submitter ON hr_complaints(submitted_by, submitted_at DESC);

CREATE OR REPLACE FUNCTION hr_complaint_autonumber()
RETURNS TRIGGER AS $$
DECLARE
  yr TEXT;
  seq INT;
BEGIN
  IF NEW.complaint_number IS NULL OR NEW.complaint_number = '' THEN
    yr := to_char(NOW() AT TIME ZONE 'America/New_York', 'YYYY');
    SELECT COALESCE(MAX(CAST(SUBSTRING(complaint_number FROM '\d+$') AS INT)), 0) + 1
      INTO seq
      FROM hr_complaints
     WHERE complaint_number LIKE 'HRC-' || yr || '-%';
    NEW.complaint_number := 'HRC-' || yr || '-' || LPAD(seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hr_complaint_autonumber ON hr_complaints;
CREATE TRIGGER trg_hr_complaint_autonumber
  BEFORE INSERT ON hr_complaints
  FOR EACH ROW EXECUTE FUNCTION hr_complaint_autonumber();

-- ============================================================
-- 3. RLS policies (added v55.72 — the original s41 forgot these)
--
-- Supabase auto-enables RLS on new tables when project-level RLS
-- is on. Without explicit policies, every INSERT/SELECT/UPDATE is
-- denied. Filing a request would error: "new row violates row-level
-- security policy for table hr_requests".
--
-- KTC pattern (matches s32 phone, s35 whatsapp): any authenticated
-- user can read/write at the database level. Privacy (super_admin
-- sees all, complaints anonymous to admins, admin scoping) is
-- enforced at the application layer.
-- ============================================================
ALTER TABLE hr_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_requests_select ON hr_requests;
CREATE POLICY hr_requests_select ON hr_requests FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS hr_requests_insert ON hr_requests;
CREATE POLICY hr_requests_insert ON hr_requests FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS hr_requests_update ON hr_requests;
CREATE POLICY hr_requests_update ON hr_requests FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS hr_requests_delete ON hr_requests;
CREATE POLICY hr_requests_delete ON hr_requests FOR DELETE
  USING (auth.uid() IS NOT NULL);

ALTER TABLE hr_complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_complaints_select ON hr_complaints;
CREATE POLICY hr_complaints_select ON hr_complaints FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS hr_complaints_insert ON hr_complaints;
CREATE POLICY hr_complaints_insert ON hr_complaints FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS hr_complaints_update ON hr_complaints;
CREATE POLICY hr_complaints_update ON hr_complaints FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS hr_complaints_delete ON hr_complaints;
CREATE POLICY hr_complaints_delete ON hr_complaints FOR DELETE
  USING (auth.uid() IS NOT NULL);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 4. Sanity check
-- ============================================================
SELECT
  (SELECT COUNT(*) FROM hr_requests) AS requests_total,
  (SELECT COUNT(*) FROM hr_requests WHERE status = 'submitted') AS requests_pending,
  (SELECT COUNT(*) FROM hr_complaints) AS complaints_total,
  (SELECT COUNT(*) FROM hr_complaints WHERE status = 'submitted') AS complaints_pending;
