-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TV + TW + TX — ALL THREE IN ONE (Max, Nov 17 2026). Repeating bills · Nextrade & RTM own books + Nextrade
-- expense → KTC bill · NextTrade / RTM advances & extra fees. Needs sql/v55-83-TO-payment-guards.sql to have been run.
-- Additive only, nothing deleted, safe to run more than once. If anything errors, NOTHING is saved — send Claude the message.
-- Run in: Supabase → your project → SQL Editor → New query → paste ALL of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. stop here if the TO payment guards are not installed yet (the advances part needs them)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_payment_guards_installed') THEN
    RAISE EXCEPTION 'Run sql/v55-83-TO-payment-guards.sql first, then this file. Nothing was changed.';
  END IF;
END $$;


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


-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TX — PAYING NEXTRADE / RTM: bills · extra professional fee · ADVANCE (Max, Nov 17 2026)
-- A payment KTC sends NextTrade or RTM can be split into the bills it covers (as today), an extra professional fee for
-- their services, and an ADVANCE (money held for later — an asset, never an expense). Later a person can:
--   • apply part of the advance to specific bills (they become paid by the advance), or
--   • turn part of the advance into a professional fee, or a fee back into advance — any amount, with who / when / why.
-- Every change is a NEW row in party_money_entries (append-only: rows can never be edited or deleted; the original is
-- never erased). The running advance balance and fee total per company can never go below zero: ONE database function
-- does every move under a lock (the same bank-line lock as the TO payment guards), so two people at once can never
-- overspend the advance. Needs sql/v55-83-TO-payment-guards.sql first. Adds a table + functions only. Safe to re-run.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.party_money_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party text NOT NULL,                                -- paid_through_parties.name (NextTrade Industries / RTM Capital)
  bucket text NOT NULL CHECK (bucket IN ('advance','fee')),
  amount numeric NOT NULL CHECK (amount <> 0),        -- + adds to the bucket, − takes from it
  kind text NOT NULL CHECK (kind IN ('payment_split','apply_to_bill','advance_to_fee','fee_to_advance')),
  bank_transaction_id uuid,                           -- payment_split: the KTC bank line (money out) it came from
  bill_id uuid REFERENCES public.vendor_bills(id),    -- apply_to_bill
  bill_payment_id uuid REFERENCES public.vendor_bill_payments(id),
  action_id uuid NOT NULL,                            -- the rows of one action share it
  entry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/New_York')::date,
  reason text,
  request_id text,                                    -- one per click: a retry never moves money twice
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS party_money_entries_request ON public.party_money_entries (request_id, bucket, kind) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS party_money_entries_party ON public.party_money_entries (party, bucket);
CREATE INDEX IF NOT EXISTS party_money_entries_line ON public.party_money_entries (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
ALTER TABLE public.party_money_entries ENABLE ROW LEVEL SECURITY;

-- append-only: an entry is never changed or removed (a mistake is corrected by a new, opposite entry)
CREATE OR REPLACE FUNCTION public.hub_party_money_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'HUB_GUARD: advance / fee entries are never changed or deleted — add a correcting entry instead.'; END $$;
DROP TRIGGER IF EXISTS party_money_entries_append_only ON public.party_money_entries;
CREATE TRIGGER party_money_entries_append_only BEFORE UPDATE OR DELETE ON public.party_money_entries
  FOR EACH ROW EXECUTE FUNCTION public.hub_party_money_append_only();

-- (Codex 17 Nov 19:50) does this company's advance pool hold ANY money a caller may not see? Over the COMPLETE ledger: a
-- split whose bank line is in one of p_hidden_accounts, or whose line is missing, or has no account → true (fails closed).
CREATE OR REPLACE FUNCTION public.hub_party_pool_restricted(p_party text, p_hidden_accounts text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.party_money_entries e LEFT JOIN public.bank_transactions b ON b.id = e.bank_transaction_id
    WHERE e.party = p_party AND e.bank_transaction_id IS NOT NULL
      AND (b.id IS NULL OR b.account_id IS NULL OR b.account_id = ANY (coalesce(p_hidden_accounts, ARRAY[]::text[]))));
$$;
-- Authoritative balances per company over the COMPLETE ledger (never a paged display list), plus whether the pool holds money
-- the caller may not see. The Hub shows a balance only when restricted = false (or the caller sees all private accounts).
CREATE OR REPLACE FUNCTION public.hub_party_pool_status(p_hidden_accounts text[])
RETURNS TABLE (party text, advance numeric, fee numeric, entries bigint, restricted boolean)
LANGUAGE sql STABLE AS $$
  SELECT e.party, round(coalesce(sum(e.amount) FILTER (WHERE e.bucket = 'advance'), 0), 2), round(coalesce(sum(e.amount) FILTER (WHERE e.bucket = 'fee'), 0), 2),
         count(*), public.hub_party_pool_restricted(e.party, p_hidden_accounts)
  FROM public.party_money_entries e GROUP BY e.party;
$$;

-- THE one way money moves between the buckets. Called only by the Hub server (service key), which has already checked
-- the signed-in person and the "advances.manage" permission.
-- p_action: 'split' (a bank line → fee + advance) · 'apply' (advance → pay one bill) · 'to_fee' · 'to_advance'
-- (Codex 17 Nov 19:50) the 9-argument first version is replaced by this one (same name + p_hidden_accounts); dropping the
-- old FUNCTION definition removes no data.
DROP FUNCTION IF EXISTS public.hub_party_money(text, text, numeric, numeric, uuid, uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.hub_party_money(p_action text, p_party text, p_amount numeric, p_fee numeric,
  p_bank_txn uuid, p_bill uuid, p_reason text, p_actor uuid, p_request_id text, p_hidden_accounts text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_action uuid := gen_random_uuid(); v_adv numeric; v_fee numeric; v_line record; v_line_used numeric; v_split numeric;
  v_bill record; v_pay uuid; v_amt numeric := round(coalesce(p_amount, 0), 2); v_fee_amt numeric := round(coalesce(p_fee, 0), 2);
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF p_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties WHERE name = p_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company %.', p_party; END IF;
  -- one click id = one move. The same click arriving again (same company, same kind of move, same amounts, same line / bill)
  -- returns the first result; a click id re-used for a DIFFERENT move is refused (Codex QA 17 Nov: replay contract).
  IF p_request_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.party_money_entries WHERE request_id = p_request_id) THEN
    IF EXISTS (SELECT 1 FROM public.party_money_entries WHERE request_id = p_request_id AND (party <> p_party
         OR kind <> CASE p_action WHEN 'split' THEN 'payment_split' WHEN 'apply' THEN 'apply_to_bill' WHEN 'to_fee' THEN 'advance_to_fee' WHEN 'to_advance' THEN 'fee_to_advance' ELSE '?' END
         OR bank_transaction_id IS DISTINCT FROM p_bank_txn OR bill_id IS DISTINCT FROM p_bill))
       OR (SELECT coalesce(sum(abs(amount)) FILTER (WHERE bucket = 'advance' OR kind = 'advance_to_fee' AND bucket = 'fee' OR kind = 'fee_to_advance' AND bucket = 'fee'), 0)
           FROM public.party_money_entries WHERE request_id = p_request_id AND NOT (kind = 'payment_split' AND bucket = 'fee'))
          <> (CASE WHEN p_action IN ('to_fee', 'to_advance') THEN 2 * round(coalesce(p_amount, 0), 2) ELSE round(coalesce(p_amount, 0), 2) END)
       OR (p_action = 'split' AND (SELECT coalesce(sum(amount), 0) FROM public.party_money_entries WHERE request_id = p_request_id AND bucket = 'fee') <> round(coalesce(p_fee, 0), 2)) THEN
      RAISE EXCEPTION 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'repeat', true);  -- the same click arrived twice — the first one stands
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || p_party, 0));
  -- PRIVATE MONEY (Codex 17 Nov 19:50): a caller who may not see some private accounts (p_hidden_accounts given) cannot move a
  -- pool that holds ANY money from them — checked over the WHOLE ledger of this company, under its lock. A source line that
  -- is missing or has no account counts as private (fails closed).
  IF p_hidden_accounts IS NOT NULL AND public.hub_party_pool_restricted(p_party, p_hidden_accounts) THEN
    RAISE EXCEPTION 'HUB_GUARD: %''s advance includes money from a private account — only someone allowed to see private accounts can move it.', p_party;
  END IF;
  SELECT coalesce(sum(amount) FILTER (WHERE bucket = 'advance'), 0), coalesce(sum(amount) FILTER (WHERE bucket = 'fee'), 0)
    INTO v_adv, v_fee FROM public.party_money_entries WHERE party = p_party;

  IF p_action = 'split' THEN
    IF v_amt < 0 OR v_fee_amt < 0 OR (v_amt + v_fee_amt) <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the advance and / or the fee (above zero).'; END IF;
    IF p_bank_txn IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the bank line of the payment.'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || p_bank_txn::text, 0)); -- same lock as bill payments (TO)
    SELECT id, amount_abs, direction, wave_business_id, third_party_payer, pending, account_id INTO v_line FROM public.bank_transactions WHERE id = p_bank_txn;
    IF v_line.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank line was not found.'; END IF;
    IF p_hidden_accounts IS NOT NULL AND (v_line.account_id IS NULL OR v_line.account_id = ANY (p_hidden_accounts)) THEN
      RAISE EXCEPTION 'HUB_GUARD: that bank line is in a private account.';
    END IF;
    IF v_line.direction <> 'out' OR v_line.pending IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: only a settled money-out line can be split.'; END IF;
    IF lower(coalesce(v_line.third_party_payer, '')) <> lower(p_party) THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is not marked as a payment to %.', p_party; END IF;
    SELECT coalesce(sum(amount), 0) INTO v_line_used FROM public.vendor_bill_payments WHERE bank_transaction_id = p_bank_txn AND voided IS NOT TRUE;
    SELECT coalesce(sum(amount), 0) INTO v_split FROM public.party_money_entries WHERE bank_transaction_id = p_bank_txn AND kind = 'payment_split';
    -- a service fee already recorded on a funded wire request for this same bank line counts as used too
    IF to_regclass('public.wire_packages') IS NOT NULL THEN
      v_split := v_split + coalesce((SELECT sum(fee_amount) FROM public.wire_packages WHERE bank_transaction_id = p_bank_txn AND status = 'attached' AND fee_amount > 0), 0);
    END IF;
    IF v_line_used + v_split + v_amt + v_fee_amt > v_line.amount_abs + 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: the payment is %; bills already take %, earlier splits / wire fees %, this split % — over by %.', round(v_line.amount_abs, 2), round(v_line_used, 2), round(v_split, 2), round(v_amt + v_fee_amt, 2), round(v_line_used + v_split + v_amt + v_fee_amt - v_line.amount_abs, 2);
    END IF;
    IF v_amt > 0 THEN INSERT INTO public.party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, reason, request_id, created_by) VALUES (p_party, 'advance', v_amt, 'payment_split', p_bank_txn, v_action, p_reason, p_request_id, p_actor); END IF;
    IF v_fee_amt > 0 THEN INSERT INTO public.party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, reason, request_id, created_by) VALUES (p_party, 'fee', v_fee_amt, 'payment_split', p_bank_txn, v_action, p_reason, p_request_id, p_actor); END IF;

  ELSIF p_action = 'apply' THEN
    IF v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount to apply (above zero).'; END IF;
    IF v_amt > v_adv + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the % advance is only % — cannot apply %.', p_party, round(v_adv, 2), v_amt; END IF;
    SELECT id, record_status, paid_via, wave_business_id INTO v_bill FROM public.vendor_bills WHERE id = p_bill;
    IF v_bill.id IS NULL OR v_bill.record_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: that bill is not an open bill.'; END IF;
    IF lower(coalesce(v_bill.paid_via, '')) <> lower(p_party) THEN RAISE EXCEPTION 'HUB_GUARD: that bill is not paid via % — only their bills can be paid from their advance.', p_party; END IF;
    -- the bill payment: the TO guard on vendor_bill_payments locks the bill and refuses paying it beyond its total
    INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by, request_id)
      VALUES (p_bill, v_amt, (now() AT TIME ZONE 'America/New_York')::date, NULL, 'advance', p_actor, p_request_id) RETURNING id INTO v_pay;
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, bill_id, bill_payment_id, action_id, reason, request_id, created_by)
      VALUES (p_party, 'advance', -v_amt, 'apply_to_bill', p_bill, v_pay, v_action, p_reason, p_request_id, p_actor);

  ELSIF p_action = 'to_fee' THEN
    IF v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount (above zero).'; END IF;
    IF v_amt > v_adv + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the % advance is only % — cannot turn % into a fee.', p_party, round(v_adv, 2), v_amt; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'HUB_GUARD: say why.'; END IF;
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, request_id, created_by) VALUES
      (p_party, 'advance', -v_amt, 'advance_to_fee', v_action, p_reason, p_request_id, p_actor),
      (p_party, 'fee', v_amt, 'advance_to_fee', v_action, p_reason, p_request_id, p_actor);

  ELSIF p_action = 'to_advance' THEN
    IF v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount (above zero).'; END IF;
    IF v_amt > v_fee + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the % fees on record are only % — cannot turn % back into advance.', p_party, round(v_fee, 2), v_amt; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'HUB_GUARD: say why.'; END IF;
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, request_id, created_by) VALUES
      (p_party, 'fee', -v_amt, 'fee_to_advance', v_action, p_reason, p_request_id, p_actor),
      (p_party, 'advance', v_amt, 'fee_to_advance', v_action, p_reason, p_request_id, p_actor);
  ELSE
    RAISE EXCEPTION 'HUB_GUARD: unknown action %.', p_action;
  END IF;

  -- final check under the lock: neither bucket can ever be below zero
  SELECT coalesce(sum(amount) FILTER (WHERE bucket = 'advance'), 0), coalesce(sum(amount) FILTER (WHERE bucket = 'fee'), 0)
    INTO v_adv, v_fee FROM public.party_money_entries WHERE party = p_party;
  IF v_adv < -0.005 OR v_fee < -0.005 THEN RAISE EXCEPTION 'HUB_GUARD: that would take the % balance below zero.', p_party; END IF;
  RETURN jsonb_build_object('ok', true, 'action_id', v_action, 'advance_balance', round(v_adv, 2), 'fee_total', round(v_fee, 2), 'bill_payment_id', v_pay);
END $$;

-- the Hub checks this before offering any advance action
CREATE OR REPLACE FUNCTION public.hub_party_money_installed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_party_money' AND pronargs = 10)
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_party_pool_status')
     AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'party_money_entries_append_only')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_payment_guards_installed');
$$;

-- only the server may call the money function
REVOKE ALL ON FUNCTION public.hub_party_money(text, text, numeric, numeric, uuid, uuid, text, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_pool_status(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_pool_restricted(text, text[]) FROM PUBLIC, anon, authenticated;

-- check: select party, bucket, sum(amount) from party_money_entries group by 1, 2;


-- DONE. Check: select 'repeating' as part, count(*) from recurring_bills union all select 'nextrade/rtm categories', count(*) from company_categories union all select 'advance entries', count(*) from party_money_entries;
