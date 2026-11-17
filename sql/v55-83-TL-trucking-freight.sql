-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TL — TRUCKING and FREIGHT typed per release (Max, Nov 17 2026)
-- Adds ONE new table. Nothing existing is changed or deleted. Safe to run more than once.
-- A figure typed here is used for that release until the trucking / shipping bill for it is in the Hub (the bill always wins).
-- Clearing a figure keeps the row with an empty amount; every change is also in the audit trail.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pl_release_part_estimates (
  release_key  text NOT NULL,
  part         text NOT NULL CHECK (part IN ('trucking', 'freight')),
  amount       numeric CHECK (amount IS NULL OR amount >= 0),
  note         text,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_key, part)
);

-- read for signed-in users; every write goes through the Hub server (same as the other report set-up tables)
ALTER TABLE public.pl_release_part_estimates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pl_release_part_estimates_read ON public.pl_release_part_estimates;
CREATE POLICY pl_release_part_estimates_read ON public.pl_release_part_estimates FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.pl_release_part_estimates TO authenticated;

-- proof: should return 1 row
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pl_release_part_estimates';
