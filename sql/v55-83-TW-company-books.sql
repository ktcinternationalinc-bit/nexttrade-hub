-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TW — NEXTRADE and RTM as their own companies (Max, Nov 17 2026), and Nextrade expenses → KTC bills.
-- Adds two companies (no Wave), their own category and rule lists, a company category on each bank line, the Nextrade →
-- KTC category mapping and the one-bill-per-Nextrade-line link. KTC's lists are NOT touched. Nothing existing is
-- changed or deleted. Safe to run more than once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. the two companies, so their banks and credit cards can be connected through Plaid (Bank → Connect → pick the company)
--    is_production = true keeps them in the 2-hourly Plaid sync; they have no Wave business and are never sent to Wave.
INSERT INTO public.wave_business_registry (wave_business_id, label, is_production)
SELECT 'NEXTRADE_BOOKS', 'Nextrade (own books — no Wave)', true
WHERE NOT EXISTS (SELECT 1 FROM public.wave_business_registry WHERE wave_business_id = 'NEXTRADE_BOOKS');
INSERT INTO public.wave_business_registry (wave_business_id, label, is_production)
SELECT 'RTM_BOOKS', 'RTM (own books — no Wave)', true
WHERE NOT EXISTS (SELECT 1 FROM public.wave_business_registry WHERE wave_business_id = 'RTM_BOOKS');

-- 2. each company's OWN category list (KTC keeps expense_categories, untouched)
CREATE TABLE IF NOT EXISTS public.company_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL CHECK (company_id IN ('NEXTRADE_BOOKS','RTM_BOOKS')),
  key text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','cogs','expense','other_income','other_expense','transfer','not_pnl')),
  is_payroll boolean NOT NULL DEFAULT false,     -- payroll lines never make a KTC bill and show as "Warehouse staff"
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 100,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);

-- 3. each company's OWN categorizing rules
CREATE TABLE IF NOT EXISTS public.company_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL CHECK (company_id IN ('NEXTRADE_BOOKS','RTM_BOOKS')),
  match_text text NOT NULL,
  category_key text NOT NULL,
  direction text NOT NULL DEFAULT 'any' CHECK (direction IN ('any','in','out')),
  active boolean NOT NULL DEFAULT true,
  hit_count integer NOT NULL DEFAULT 0,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_rules_one_per_text ON public.company_rules (company_id, lower(match_text), direction);

-- 4. the company category on a bank line (KTC's own `classification` column is left alone)
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS company_category text;
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS company_category_source text;
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS company_category_by uuid;
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS company_category_at timestamptz;
CREATE INDEX IF NOT EXISTS bank_transactions_company_cat_ix ON public.bank_transactions (wave_business_id, company_category);

-- 5. starting categories (Max adds his own on the screen). Money KTC sends Nextrade is a TRANSFER IN, never income.
INSERT INTO public.company_categories (company_id, key, label, kind, is_payroll, sort) VALUES
  ('NEXTRADE_BOOKS', 'money_from_ktc',   'Money from KTC (transfer in)',        'transfer', false, 10),
  ('NEXTRADE_BOOKS', 'own_transfer',     'Transfer between own accounts',       'transfer', false, 20),
  ('NEXTRADE_BOOKS', 'card_payment',     'Credit card payment (transfer)',      'transfer', false, 30),
  ('NEXTRADE_BOOKS', 'payroll',          'Payroll (Warehouse staff)',           'expense',  true,  40),
  ('NEXTRADE_BOOKS', 'other_expense',    'Other expense',                       'expense',  false, 90),
  ('RTM_BOOKS',      'own_transfer',     'Transfer between own accounts',       'transfer', false, 20),
  ('RTM_BOOKS',      'card_payment',     'Credit card payment (transfer)',      'transfer', false, 30),
  ('RTM_BOOKS',      'other_expense',    'Other expense',                       'expense',  false, 90)
ON CONFLICT (company_id, key) DO NOTHING;

-- 6. (TW) Nextrade category → KTC category, set once per category (e.g. Electricity → Utilities – Electricity)
CREATE TABLE IF NOT EXISTS public.company_category_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL CHECK (company_id IN ('NEXTRADE_BOOKS')),
  category_key text NOT NULL,
  ktc_category text,                               -- expense_categories.key (KTC's list)
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, category_key)
);

-- 7. (TW) ONE KTC bill per Nextrade bank line, EVER. The unique source line is the guard: two people categorizing the same
--    line at the same moment can never make two bills. A line no longer an expense VOIDS its link (and its bill) — the
--    row stays; categorizing it again brings the SAME bill back.
CREATE TABLE IF NOT EXISTS public.company_bill_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_bank_transaction_id uuid NOT NULL,
  company_id text NOT NULL CHECK (company_id IN ('NEXTRADE_BOOKS')),
  bill_id uuid REFERENCES public.vendor_bills(id),
  mode text CHECK (mode IN ('created','attached')),  -- created = the Hub made the bill · attached = an existing bill (e.g. repeating rent)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','void')),
  set_paid_via boolean NOT NULL DEFAULT false,       -- attaching set "paid via NextTrade" on that bill (undone if detached)
  category_key text,
  message text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_bill_links_one_per_line ON public.company_bill_links (source_bank_transaction_id);
-- one bill is attached to at most one Nextrade line at a time
CREATE UNIQUE INDEX IF NOT EXISTS company_bill_links_one_line_per_bill ON public.company_bill_links (bill_id) WHERE status = 'active' AND bill_id IS NOT NULL;

-- 8. server-only tables (the Hub reads and writes them with its server key)
ALTER TABLE public.company_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_category_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bill_links ENABLE ROW LEVEL SECURITY;


-- 8b. (Codex QA 17 Nov, P1-2) ONE database function categorizes a Nextrade / RTM line AND makes / updates / voids / attaches
--     its KTC bill in ONE transaction: the line's category, the KTC bill and the link are all saved, or NOTHING is (any
--     error raises and Postgres undoes every change). Locks the bank line (and the bill) so two people at once cannot
--     make two bills. The Hub server only proposes (which bill to attach, the new bill's fields); this function re-checks
--     everything under the locks. Called only by the Hub server (service key).
CREATE OR REPLACE FUNCTION public.hub_company_categorize(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_line record; v_cat record; v_link record; v_bill record; v_want boolean := false; v_action text := 'none';
  v_bill_id uuid; v_paid numeric; v_party text := coalesce(p->>'party', 'NextTrade Industries');
  v_company text := p->>'company_id'; v_key text := nullif(p->>'category_key', ''); v_actor uuid := nullif(p->>'actor', '')::uuid;
  v_ktc text := nullif(p->>'ktc_category', ''); v_attach uuid := nullif(p->>'attach_bill_id', '')::uuid; v_set_via boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_company NOT IN ('NEXTRADE_BOOKS', 'RTM_BOOKS') THEN RAISE EXCEPTION 'HUB_GUARD: say which company (Nextrade or RTM).'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || (p->>'line_id'), 0));
  SELECT id, wave_business_id, direction, amount_abs, company_category INTO v_line FROM public.bank_transactions WHERE id = (p->>'line_id')::uuid FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank line was not found.'; END IF;
  IF v_line.wave_business_id IS DISTINCT FROM v_company THEN RAISE EXCEPTION 'HUB_GUARD: that line is not a % line.', CASE WHEN v_company = 'RTM_BOOKS' THEN 'RTM' ELSE 'Nextrade' END; END IF;
  IF v_key IS NOT NULL THEN
    SELECT key, kind, is_payroll, active INTO v_cat FROM public.company_categories WHERE company_id = v_company AND key = v_key;
    IF v_cat.key IS NULL OR v_cat.active IS NOT TRUE THEN RAISE EXCEPTION 'HUB_GUARD: pick one of the company''s own categories.'; END IF;
    v_want := v_company = 'NEXTRADE_BOOKS' AND v_cat.kind IN ('expense', 'cogs', 'other_expense') AND v_cat.is_payroll IS NOT TRUE AND v_line.direction = 'out';
  END IF;

  IF v_company = 'NEXTRADE_BOOKS' THEN
    SELECT * INTO v_link FROM public.company_bill_links WHERE source_bank_transaction_id = v_line.id FOR UPDATE;
    -- always assigned (a row of NULLs when there is no bill yet), so later checks can read it
    SELECT id, record_status, paid_via, bill_number, category, total_amount INTO v_bill FROM public.vendor_bills WHERE id = v_link.bill_id FOR UPDATE;

    IF NOT v_want THEN
      IF v_link.id IS NOT NULL AND v_link.status = 'active' THEN
        IF v_link.mode = 'created' AND v_bill.record_status = 'active' THEN
          SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = v_bill.id AND voided IS NOT TRUE;
          IF v_paid > 0 THEN RAISE EXCEPTION 'HUB_GUARD: KTC bill % made from this line already has money recorded on it — undo that payment first, then change the category.', v_bill.bill_number; END IF;
          IF to_regclass('public.wire_package_lines') IS NOT NULL AND EXISTS (SELECT 1 FROM public.wire_package_lines WHERE bill_id = v_bill.id AND is_open IS TRUE) THEN
            RAISE EXCEPTION 'HUB_GUARD: KTC bill % made from this line is on a wire — take it off the wire first, then change the category.', v_bill.bill_number;
          END IF;
          UPDATE public.vendor_bills SET record_status = 'void', updated_at = now() WHERE id = v_bill.id;
          v_action := 'voided';
        ELSIF v_link.mode = 'attached' THEN
          IF v_link.set_paid_via AND lower(coalesce(v_bill.paid_via, '')) = lower(v_party) THEN UPDATE public.vendor_bills SET paid_via = NULL, updated_at = now() WHERE id = v_bill.id; END IF;
          v_action := 'detached';
        END IF;
        UPDATE public.company_bill_links SET status = 'void', category_key = v_key, updated_by = v_actor, updated_at = now() WHERE id = v_link.id;
        v_bill_id := v_link.bill_id;
      END IF;
    ELSE
      IF v_link.id IS NOT NULL AND v_link.bill_id IS NOT NULL AND v_bill.id IS NOT NULL AND v_bill.record_status <> 'deleted'
         AND NOT (v_link.mode = 'attached' AND v_bill.record_status <> 'active') THEN
        -- the SAME bill, never a second one
        IF v_link.mode = 'created' THEN
          UPDATE public.vendor_bills SET record_status = 'active', category = coalesce(v_ktc, category), updated_at = now() WHERE id = v_bill.id;
        END IF;
        UPDATE public.company_bill_links SET status = 'active', category_key = v_key, updated_by = v_actor, updated_at = now() WHERE id = v_link.id;
        v_action := CASE WHEN v_link.status = 'void' THEN 'restored' ELSE 'updated' END; v_bill_id := v_bill.id;
      ELSE
        -- attach the open KTC bill the server proposed — re-checked here under its lock
        IF v_attach IS NOT NULL THEN
          SELECT id, record_status, paid_via, bill_number, total_amount, wave_business_id INTO v_bill FROM public.vendor_bills WHERE id = v_attach FOR UPDATE;
          SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = v_attach AND voided IS NOT TRUE;
          IF v_bill.id IS NULL OR v_bill.record_status <> 'active' OR abs(v_bill.total_amount - v_line.amount_abs) > 0.01 OR v_paid + 0.005 >= v_bill.total_amount
             OR EXISTS (SELECT 1 FROM public.company_bill_links WHERE bill_id = v_attach AND status = 'active' AND source_bank_transaction_id <> v_line.id) THEN
            v_attach := NULL; -- no longer attachable: make a new bill instead
          END IF;
        END IF;
        IF v_attach IS NOT NULL THEN
          v_set_via := v_bill.paid_via IS NULL AND v_paid = 0;
          IF v_set_via THEN UPDATE public.vendor_bills SET paid_via = v_party, updated_at = now() WHERE id = v_attach; END IF;
          v_bill_id := v_attach; v_action := 'attached';
        ELSE
          IF p->'bill' IS NULL OR jsonb_typeof(p->'bill') <> 'object' THEN RAISE EXCEPTION 'HUB_GUARD: the KTC bill details are missing.'; END IF;
          INSERT INTO public.vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, due_date, total_amount, category, paid_via, currency, record_status, notes, created_by)
          VALUES (p->'bill'->>'wave_business_id', p->'bill'->>'vendor_name', p->'bill'->>'bill_number', (p->'bill'->>'bill_date')::date, (p->'bill'->>'due_date')::date,
                  v_line.amount_abs, v_ktc, v_party, 'USD', 'active', p->'bill'->>'notes', v_actor)
          RETURNING id INTO v_bill_id;
          v_action := 'created';
        END IF;
        IF v_link.id IS NULL THEN
          INSERT INTO public.company_bill_links (source_bank_transaction_id, company_id, bill_id, mode, status, set_paid_via, category_key, created_by, updated_by)
          VALUES (v_line.id, v_company, v_bill_id, CASE WHEN v_action = 'attached' THEN 'attached' ELSE 'created' END, 'active', v_set_via, v_key, v_actor, v_actor);
        ELSE
          UPDATE public.company_bill_links SET bill_id = v_bill_id, mode = CASE WHEN v_action = 'attached' THEN 'attached' ELSE 'created' END, status = 'active',
            set_paid_via = v_set_via, category_key = v_key, message = NULL, updated_by = v_actor, updated_at = now() WHERE id = v_link.id;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.bank_transactions SET company_category = v_key, company_category_source = CASE WHEN v_key IS NULL THEN NULL ELSE coalesce(p->>'source', 'manual') END,
    company_category_by = v_actor, company_category_at = now() WHERE id = v_line.id;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'company_line_categorized', 'bank_transaction', v_line.id::text,
    jsonb_build_object('company', v_company, 'from', v_line.company_category, 'to', v_key, 'source', coalesce(p->>'source', 'manual'), 'ktc_bill_action', v_action, 'ktc_bill_id', v_bill_id));
  IF v_action <> 'none' THEN
    INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor,
      CASE v_action WHEN 'created' THEN 'bill_created' WHEN 'voided' THEN 'nextrade_bill_voided' WHEN 'detached' THEN 'nextrade_bill_detached' WHEN 'attached' THEN 'nextrade_bill_attached' WHEN 'restored' THEN 'nextrade_bill_restored' ELSE 'nextrade_bill_updated' END,
      'vendor_bill', v_bill_id::text, jsonb_build_object('from_nextrade_line', v_line.id, 'category', v_key, 'ktc_category', v_ktc, 'paid_via_set', v_set_via));
  END IF;
  RETURN jsonb_build_object('ok', true, 'action', v_action, 'bill_id', v_bill_id, 'bill_number', (SELECT bill_number FROM public.vendor_bills WHERE id = v_bill_id));
END $$;
REVOKE ALL ON FUNCTION public.hub_company_categorize(jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.hub_company_books_installed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_company_categorize');
$$;

-- check:
-- select wave_business_id, label, is_production from wave_business_registry where wave_business_id in ('NEXTRADE_BOOKS','RTM_BOOKS');
-- select company_id, key, label, kind, is_payroll from company_categories order by company_id, sort;
