-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-NK — HR PERFORMANCE REVIEWS
-- Stores each review with its measured-metrics snapshot FROZEN IN, so a review
-- remains exactly what the manager saw at review time even as live data moves.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hr_performance_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL,
  employee_name    text,
  reviewer_id      uuid,
  reviewer_name    text,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  metrics          jsonb,          -- frozen measured snapshot (attendance + tickets)
  ai_narrative     text,           -- Jenna's original draft, kept verbatim
  narrative_final  text,           -- the narrative after the manager's edits
  overall_rating   int CHECK (overall_rating BETWEEN 1 AND 5),
  strengths        text,
  improvements     text,
  goals            text,
  manager_comments text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perf_reviews_employee ON hr_performance_reviews (employee_id, created_at DESC);

ALTER TABLE hr_performance_reviews ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "perf_reviews_select" ON hr_performance_reviews FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "perf_reviews_insert" ON hr_performance_reviews FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "perf_reviews_update" ON hr_performance_reviews FOR UPDATE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "perf_reviews_delete" ON hr_performance_reviews FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- VERIFICATION
SELECT '1. hr_performance_reviews table' AS check_name,
       CASE WHEN to_regclass('public.hr_performance_reviews') IS NULL THEN '❌ MISSING' ELSE '✅ exists' END AS result
UNION ALL
SELECT '2. RLS policies (need 4)', COUNT(*)::text FROM pg_policies WHERE tablename='hr_performance_reviews';
