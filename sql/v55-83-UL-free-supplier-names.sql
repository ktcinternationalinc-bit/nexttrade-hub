-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UL — supplier descriptions that come FREE (Max, Nov 18 2026: "Texas cardboard come at a 0 cost for us. so thats that")
-- A $0 bill line normally means "price missing", so the Profitability report shows that product's cost as UNKNOWN rather than guess.
-- A description listed here is different: its $0 is a REAL zero cost, so it is averaged into the product's cost per lb as free pounds.
-- Every other $0 line stays unknown. Nothing is deleted. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pl_free_bill_names (
  name_key    text PRIMARY KEY,               -- the description, lower case, letters and numbers only (same key the report uses)
  raw_name    text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pl_free_bill_names ENABLE ROW LEVEL SECURITY;           -- the report reads it on the server only
REVOKE ALL ON public.pl_free_bill_names FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pl_free_bill_names TO service_role;

INSERT INTO public.pl_free_bill_names (name_key, raw_name, note, created_by)
VALUES ('texas cardboard paper lbs', 'Texas Cardboard Paper (LBS)', 'NexPac: comes at $0 cost (Max, Nov 18)', 'Max Nov 18')
ON CONFLICT (name_key) DO UPDATE SET active = true, raw_name = EXCLUDED.raw_name, note = EXCLUDED.note;

-- check
SELECT raw_name, active, note FROM public.pl_free_bill_names ORDER BY raw_name;
