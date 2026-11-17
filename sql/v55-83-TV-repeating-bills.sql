-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TV — REPEATING BILLS (Max, Nov 17 2026)
-- A bill that comes back on a schedule (e.g. the monthly "Warehouse staff" bill) is set up once; the Hub creates each
-- bill on its date. Adds two tables and two columns only. Nothing existing is changed or deleted. Safe to run more than
-- once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. the repeating bills themselves (never deleted: stopped ones stay with status 'stopped')
CREATE TABLE IF NOT EXISTS public.recurring_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_business_id text NOT NULL,                       -- the company the bills belong to
  vendor_name text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  category text,
  release_number text,
  frequency text NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  start_date date NOT NULL,
  end_date date,
  lead_days integer NOT NULL DEFAULT 7 CHECK (lead_days >= 0 AND lead_days <= 60),
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','stopped')),
  resume_from date,                                     -- no bills for dates before this (set on resume / schedule edit)
  last_run_at timestamptz,
  last_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

-- 2. one row per repeating bill per date: what happened on that date (bill made, or skipped as a likely duplicate).
--    The UNIQUE pair is what makes "one bill per repeating bill per date" hold even when two runs happen at once.
CREATE TABLE IF NOT EXISTS public.recurring_bill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_id uuid NOT NULL REFERENCES public.recurring_bills(id),
  occurrence_date date NOT NULL,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','created','skipped_duplicate','failed')),
  bill_id uuid REFERENCES public.vendor_bills(id),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recurring_bill_runs_one_per_date ON public.recurring_bill_runs (recurring_id, occurrence_date);

-- 3. the bill remembers which repeating bill and date made it — and the database refuses a second bill for the same pair
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS recurring_id uuid;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS recurring_date date;
CREATE UNIQUE INDEX IF NOT EXISTS vendor_bills_one_per_recurring_date ON public.vendor_bills (recurring_id, recurring_date)
  WHERE recurring_id IS NOT NULL;

-- 4. server-only tables: the Hub reads and writes them with its server key; nobody reads them directly from a browser
ALTER TABLE public.recurring_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_bill_runs ENABLE ROW LEVEL SECURITY;

-- check (should show the two tables and the two new columns):
-- select table_name from information_schema.tables where table_name in ('recurring_bills','recurring_bill_runs');
-- select column_name from information_schema.columns where table_name = 'vendor_bills' and column_name in ('recurring_id','recurring_date');
