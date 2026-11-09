-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RQ — Max, Nov 9 21:10 / 21:18:
--  "FOR all of NEXPAC BILLS ... broken down for each product billed line with
--   2 lines. actual cost and commission line"
--  "it is supposed to be cost then 12.5% is added to the cost"
--  "we also need a section to enter the prices of the types of products
--   supplied so the HUB can validate that the correct prices were entered into
--   the bill. Same for trucking.. or any other type of charge.. rule creation
--   ... if there is an issue that the HUB sees, then it should flag it for
--   manual intervention."
-- Safe to re-run. Written only by the Hub server (service key); signed-in users
-- may read. Run AFTER v55-83-RP.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) the lines of a bill (billed amount; for a commission vendor also its cost + commission parts)
CREATE TABLE IF NOT EXISTS public.vendor_bill_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id           uuid NOT NULL REFERENCES public.vendor_bills(id) ON DELETE CASCADE,
  line_no           int  NOT NULL,
  line_kind         text NOT NULL DEFAULT 'item' CHECK (line_kind IN ('item', 'charge', 'commission')),
  description       text NOT NULL DEFAULT '',
  item_key          text,
  qty               numeric,
  unit              text,
  unit_price        numeric,
  amount            numeric,              -- the amount printed on this line
  cost_amount       numeric,              -- commission vendor (NexPac): the product's cost (= amount; products are printed at cost)
  commission_amount numeric,              -- commission vendor: this product's share of the bill's commission line (12.5% of cost)
  commission_rate   numeric,
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('read_from_bill', 'manual')),
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bill_id, line_no)
);
ALTER TABLE public.vendor_bill_lines ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'item';
CREATE INDEX IF NOT EXISTS idx_vendor_bill_lines_bill ON public.vendor_bill_lines (bill_id);
CREATE INDEX IF NOT EXISTS idx_vendor_bill_lines_item ON public.vendor_bill_lines (item_key);

-- 2) which vendors bill cost + a commission (NexPac: 12.5% added to cost)
CREATE TABLE IF NOT EXISTS public.bill_commission_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_match text NOT NULL,
  rate         numeric NOT NULL CHECK (rate > 0 AND rate < 1),
  active       boolean NOT NULL DEFAULT true,
  note         text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_commission_vendor ON public.bill_commission_rules (lower(vendor_match)) WHERE active;
INSERT INTO public.bill_commission_rules (vendor_match, rate, note, created_by)
SELECT 'NexPac', 0.125, 'Max, Nov 9 2026: cost, then 12.5% is added to the cost (NexPac prints products at cost + one Commission 12.5% line)', 'setup'
WHERE NOT EXISTS (SELECT 1 FROM public.bill_commission_rules WHERE lower(vendor_match) = 'nexpac');

-- 3) expected prices: a product or service (optionally per vendor / bill type) and what it should cost
CREATE TABLE IF NOT EXISTS public.bill_price_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_match        text,                 -- empty = any vendor
  bill_type           text CHECK (bill_type IS NULL OR bill_type IN ('trucking', 'shipping', 'bonded_brokerage', 'supplier')),
  item_match          text,                 -- words that must appear on the line; empty = a whole-bill rule
  unit                text,                 -- e.g. yd, m, roll, load, container
  expected_unit_price numeric CHECK (expected_unit_price IS NULL OR expected_unit_price >= 0),
  expected_amount     numeric CHECK (expected_amount IS NULL OR expected_amount >= 0),
  tolerance_pct       numeric NOT NULL DEFAULT 2 CHECK (tolerance_pct >= 0 AND tolerance_pct <= 100),
  applies_to          text NOT NULL DEFAULT 'cost' CHECK (applies_to IN ('cost', 'billed')),
  active              boolean NOT NULL DEFAULT true,
  note                text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_unit_price IS NOT NULL OR expected_amount IS NOT NULL),
  CHECK (NULLIF(btrim(COALESCE(vendor_match, '')), '') IS NOT NULL OR bill_type IS NOT NULL OR NULLIF(btrim(COALESCE(item_match, '')), '') IS NOT NULL)
);

-- 4) the Hub's price check on each bill, and the person who resolved its flags
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS price_check_status text;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS price_check jsonb;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS price_check_at timestamptz;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS price_resolved_by text;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS price_resolved_at timestamptz;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS price_resolved_note text;
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_price_check_status_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_price_check_status_check
  CHECK (price_check_status IS NULL OR price_check_status IN ('ok', 'flagged', 'no_rules', 'not_checked'));

-- 5) a validated bill's lines are frozen (reopen the validation to change them)
CREATE OR REPLACE FUNCTION public.vendor_bill_lines_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT validation_status INTO st FROM public.vendor_bills WHERE id = COALESCE(NEW.bill_id, OLD.bill_id);
  IF st = 'validated' THEN RAISE EXCEPTION 'This bill is validated — reopen its validation to change its lines.'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_vendor_bill_lines_lock ON public.vendor_bill_lines;
CREATE TRIGGER trg_vendor_bill_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_bill_lines
  FOR EACH ROW EXECUTE FUNCTION public.vendor_bill_lines_lock();

-- 6) a flagged bill is validated only with a written resolution
CREATE OR REPLACE FUNCTION public.vendor_bills_validation_needs_price_ok() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.validation_status = 'validated' AND COALESCE(OLD.validation_status, '') <> 'validated'
     AND NEW.price_check_status = 'flagged' AND length(btrim(COALESCE(NEW.price_resolved_note, ''))) < 10 THEN
    RAISE EXCEPTION 'The price check flagged this bill — write how the price issue was resolved before validating it.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vendor_bills_validation_needs_price_ok ON public.vendor_bills;
CREATE TRIGGER trg_vendor_bills_validation_needs_price_ok BEFORE UPDATE OF validation_status ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.vendor_bills_validation_needs_price_ok();

-- 7) read for signed-in users; writes only through the Hub server
ALTER TABLE public.vendor_bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_price_rules ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vendor_bill_lines', 'bill_commission_rules', 'bill_price_rules'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)', t || '_write', t);
  END LOOP;
END $$;
