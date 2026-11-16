-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SY — PRODUCT / CUSTOMER / INVOICE PROFITABILITY (reporting set-up only)
-- Max, Nov 16 2026: "Let me select multiple invoice product descriptions, combine them into one reporting group, and
--   choose its display name" · "explicitly associate relevant purchase/bill descriptions with that group" ·
--   "1 yard = 2.5 lb, 1 linear meter = 2.5 lb ... explicit and configurable" · "Each shipment needs a pricing basis:
--   EXW, CNF, or goods with trucking included" · "occasionally one invoice covers two containers/releases" ·
--   "No changes to original invoices, inventory, or accounting entries merely to make this report work."
--
-- WHAT THIS ADDS: seven small tables that hold ONLY what a person decides for the report (which names belong together,
-- which unit a description is sold in, the pricing basis of an invoice, …). It changes NO existing table and NO
-- existing row. Invoices, bills, inventory and the ledger are read, never written.
-- Written only by the Hub server (service key); signed-in users may read. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) a reporting group = one product under a name YOU choose
CREATE TABLE IF NOT EXISTS public.pl_product_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 2) the descriptions inside a group: 'invoice' = what we call it when we sell, 'bill' = what the supplier calls it
CREATE TABLE IF NOT EXISTS public.pl_group_names (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.pl_product_groups(id),
  source      text NOT NULL CHECK (source IN ('invoice', 'bill')),
  name_key    text NOT NULL,
  raw_name    text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  removed_by  text,
  removed_at  timestamptz
);
-- an invoice description belongs to ONE group at a time; a bill description may serve several groups' costs only if a
-- person links it to each on purpose, so only invoice names are unique
CREATE UNIQUE INDEX IF NOT EXISTS uq_pl_group_invoice_name ON public.pl_group_names (name_key) WHERE active AND source = 'invoice';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pl_group_bill_name ON public.pl_group_names (group_id, name_key) WHERE active AND source = 'bill';
CREATE INDEX IF NOT EXISTS ix_pl_group_names_group ON public.pl_group_names (group_id) WHERE active;

-- 3) the unit a sales description is sold in (invoice lines carry a quantity but no unit) — set once per description
CREATE TABLE IF NOT EXISTS public.pl_name_units (
  name_key    text PRIMARY KEY,
  raw_name    text,
  unit        text NOT NULL CHECK (unit IN ('lb', 'yd', 'lm')),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- 4) …and an override for one invoice line, when that line was sold in another unit
CREATE TABLE IF NOT EXISTS public.pl_line_units (
  invoice_item_id uuid PRIMARY KEY,
  unit            text NOT NULL CHECK (unit IN ('lb', 'yd', 'lm')),
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 5) pounds per unit — OUR reporting weights, not a physical conversion between yards and metres
CREATE TABLE IF NOT EXISTS public.pl_unit_factors (
  unit            text PRIMARY KEY CHECK (unit IN ('lb', 'yd', 'lm')),
  pounds_per_unit numeric NOT NULL CHECK (pounds_per_unit > 0),
  note            text,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.pl_unit_factors (unit, pounds_per_unit, note) VALUES
  ('lb', 1,   'pounds'),
  ('yd', 2.5, 'business reporting weight: 1 yard = 2.5 lb'),
  ('lm', 2.5, 'business reporting weight: 1 linear metre = 2.5 lb')
ON CONFLICT (unit) DO NOTHING;

-- 6) what a person decided about an invoice FOR THE REPORT: pricing basis and the transportation inside the price
CREATE TABLE IF NOT EXISTS public.pl_invoice_terms (
  invoice_id          uuid PRIMARY KEY,
  basis               text CHECK (basis IS NULL OR basis IN ('EXW', 'CNF', 'TRUCKING_INCLUDED')),
  embedded_transport  numeric CHECK (embedded_transport IS NULL OR embedded_transport >= 0),
  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- 7) an invoice on two releases: how many pounds of each line went on each release
CREATE TABLE IF NOT EXISTS public.pl_line_release_pounds (
  invoice_item_id uuid NOT NULL,
  release_key     text NOT NULL,
  pounds          numeric NOT NULL CHECK (pounds > 0),
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_item_id, release_key)
);
-- 8) an outbound transportation ESTIMATE for a release, used only until the real bill arrives (never added to it)
CREATE TABLE IF NOT EXISTS public.pl_release_estimates (
  release_key        text PRIMARY KEY,
  outbound_estimate  numeric NOT NULL CHECK (outbound_estimate >= 0),
  note               text,
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- read for signed-in users; every write goes through the Hub server
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pl_product_groups', 'pl_group_names', 'pl_name_units', 'pl_line_units', 'pl_unit_factors', 'pl_invoice_terms', 'pl_line_release_pounds', 'pl_release_estimates'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_read', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- proof
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'pl\_%' ORDER BY table_name;
