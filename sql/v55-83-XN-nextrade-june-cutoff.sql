-- ===================================================================================================
-- v55.83-XN - NEXTRADE: NO KTC BILLS FROM NEXTRADE LINES BEFORE 1 JUNE 2026 (Max, 21 Nov 2026)
-- Max: "JUST ONE BUTTON TO IGNORE ALL OF THEM FROM CREATING KTC BILLS PRIOR TO JUNE 1 2026" (so they are not sent to KTC to pay).
-- 1. company_ktc_bill_cutoff: one row (Nextrade only): the cut-off date and whether it is ON.
-- 2. company_bill_links.cutoff_voided: marks the KTC bills the button voided, so turning it OFF brings back exactly those.
-- 3. hub_company_bill_cutoff(p): the button. ON voids every KTC bill MADE from a Nextrade line dated before the cut-off (never
--    deleted; a bill with money recorded on it or on an open wire is left alone and listed). OFF brings those bills back.
-- 4. hub_company_categorize: the same function as v55.83-UD with ONE change - while the cut-off is ON, a line dated before it
--    never makes a KTC bill (categorizing the Nextrade line itself works as before).
-- Needs sql/v55-83-UD-pay-nextrade.sql first (installed). Nothing is deleted. Safe to re-run.
-- Run in: Supabase -> your project -> SQL Editor -> New query -> paste all of this -> Run
-- ===================================================================================================
CREATE TABLE IF NOT EXISTS public.company_ktc_bill_cutoff (
  company_id text PRIMARY KEY CHECK (company_id = 'NEXTRADE_BOOKS'),
  cutoff_date date NOT NULL,
  is_on boolean NOT NULL DEFAULT false,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_ktc_bill_cutoff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_ktc_bill_cutoff FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_ktc_bill_cutoff TO service_role;
ALTER TABLE public.company_bill_links ADD COLUMN IF NOT EXISTS cutoff_voided boolean NOT NULL DEFAULT false;

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
  SELECT id, wave_business_id, direction, amount_abs, company_category, transfer_group_id, date INTO v_line FROM public.bank_transactions WHERE id = (p->>'line_id')::uuid FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank line was not found.'; END IF;
  IF v_line.wave_business_id IS DISTINCT FROM v_company THEN RAISE EXCEPTION 'HUB_GUARD: that line is not a % line.', CASE WHEN v_company = 'RTM_BOOKS' THEN 'RTM' ELSE 'Nextrade' END; END IF;
  -- v55.83-UB: a line paired as a transfer keeps its transfer category until it is unpaired (the pair / unpair functions pass pairing=true)
  IF v_line.transfer_group_id IS NOT NULL AND coalesce(p->>'pairing', '') <> 'true' THEN
    RAISE EXCEPTION 'HUB_GUARD: this line is paired as a transfer — unpair it first (↔ Unpair), then pick another category.';
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT key, kind, is_payroll, active, direction, makes_ktc_bill INTO v_cat FROM public.company_categories WHERE company_id = v_company AND key = v_key;
    IF v_cat.key IS NULL OR v_cat.active IS NOT TRUE THEN RAISE EXCEPTION 'HUB_GUARD: pick one of the company''s own categories.'; END IF;
    -- v55.83-UB: a category made for money IN cannot go on money OUT (and the other way round)
    IF v_cat.direction IN ('in', 'out') AND v_cat.direction <> v_line.direction THEN
      RAISE EXCEPTION 'HUB_GUARD: that category is for money %, and this line is money %.', v_cat.direction, v_line.direction;
    END IF;
    -- v55.83-UD: a category can say "KTC pays this" (makes_ktc_bill) — Warehouse staff payroll now does; NULL keeps the old rule
    v_want := v_company = 'NEXTRADE_BOOKS' AND v_line.direction = 'out'
      AND coalesce(v_cat.makes_ktc_bill, v_cat.kind IN ('expense', 'cogs', 'other_expense') AND v_cat.is_payroll IS NOT TRUE);
    -- v55.83-XN (Max, 21 Nov: "ignore all of them from creating KTC bills prior to June 1 2026") - while the company's cut-off is ON,
    -- a line dated before it never makes, keeps or revives a KTC bill (an existing one goes down the ordinary void path below).
    IF v_want AND EXISTS (SELECT 1 FROM public.company_ktc_bill_cutoff c WHERE c.company_id = v_company AND c.is_on IS TRUE AND v_line.date < c.cutoff_date) THEN v_want := false; END IF;
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

-- every UD click, kept for good: the same click again returns the first result; the same click id for anything else is refused
CREATE TABLE IF NOT EXISTS public.hub_party_requests (
  request_id text PRIMARY KEY, action text NOT NULL, party text NOT NULL, fingerprint text NOT NULL, result jsonb,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hub_party_requests ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS hub_party_requests_append_only ON public.hub_party_requests;
CREATE TRIGGER hub_party_requests_append_only BEFORE UPDATE OR DELETE ON public.hub_party_requests FOR EACH ROW EXECUTE FUNCTION public.hub_party_money_append_only();

-- 2. the starting balance: a new kind of advance entry, who may see it, and which entry a correction corrects
ALTER TABLE public.party_money_entries DROP CONSTRAINT IF EXISTS party_money_entries_kind_check;
ALTER TABLE public.party_money_entries ADD CONSTRAINT party_money_entries_kind_check
  CHECK (kind IN ('payment_split','apply_to_bill','advance_to_fee','fee_to_advance','opening_balance'));
ALTER TABLE public.party_money_entries ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE public.party_money_entries ADD COLUMN IF NOT EXISTS corrects_id uuid REFERENCES public.party_money_entries(id);

-- the pool rule from UB, plus: an entry the super admin marked private (a starting balance staff may not see) restricts the pool
CREATE OR REPLACE FUNCTION public.hub_party_pool_restricted(p_party text, p_hidden_accounts text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.party_money_entries e LEFT JOIN public.bank_transactions b ON b.id = e.bank_transaction_id
      LEFT JOIN public.plaid_accounts a ON a.plaid_account_id = b.account_id
    WHERE e.party = p_party AND e.bank_transaction_id IS NOT NULL
      AND (b.id IS NULL OR b.account_id IS NULL OR a.plaid_account_id IS NULL OR b.account_id = ANY (coalesce(p_hidden_accounts, ARRAY[]::text[])) OR coalesce(a.is_private, false)))
  OR EXISTS (SELECT 1 FROM public.party_money_entries e WHERE e.party = p_party AND e.is_private IS TRUE);
$$;

REVOKE ALL ON FUNCTION public.hub_company_categorize(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_company_categorize(jsonb) TO service_role;

-- the button. p: { actor, company_id: 'NEXTRADE_BOOKS', on: true|false, cutoff_date: 'YYYY-MM-DD' (ON only) }
CREATE OR REPLACE FUNCTION public.hub_company_bill_cutoff(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid := nullif(p->>'actor', '')::uuid; v_company text := p->>'company_id'; v_on boolean := (p->>'on')::boolean;
  v_date date; r record; v_paid numeric; v_amt numeric; v_done uuid[] := '{}'; v_kept jsonb := '[]'::jsonb; v_total numeric := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_company IS DISTINCT FROM 'NEXTRADE_BOOKS' THEN RAISE EXCEPTION 'HUB_GUARD: the cut-off is for Nextrade only.'; END IF;
  IF v_on IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: say ON or OFF.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-bill-cutoff:' || v_company, 0));
  IF v_on THEN
    v_date := nullif(p->>'cutoff_date', '')::date;
    IF v_date IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the cut-off date is missing.'; END IF;
    INSERT INTO public.company_ktc_bill_cutoff (company_id, cutoff_date, is_on, set_by, set_at) VALUES (v_company, v_date, true, v_actor, now())
      ON CONFLICT (company_id) DO UPDATE SET cutoff_date = EXCLUDED.cutoff_date, is_on = true, set_by = EXCLUDED.set_by, set_at = now();
    FOR r IN SELECT l.id AS link_id, l.bill_id, l.source_bank_transaction_id AS line_id
               FROM public.company_bill_links l JOIN public.bank_transactions b ON b.id = l.source_bank_transaction_id
              WHERE l.company_id = v_company AND l.status = 'active' AND l.mode = 'created' AND b.date < v_date
              ORDER BY b.date, l.id LOOP
      -- the SAME per-line lock hub_company_categorize takes, so a person categorizing this line at this moment waits
      PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || r.line_id::text, 0));
      PERFORM 1 FROM public.company_bill_links WHERE id = r.link_id AND status = 'active' AND mode = 'created' FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      SELECT total_amount INTO v_amt FROM public.vendor_bills WHERE id = r.bill_id AND record_status = 'active' FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = r.bill_id AND voided IS NOT TRUE;
      IF v_paid > 0 OR (to_regclass('public.wire_package_lines') IS NOT NULL AND EXISTS (SELECT 1 FROM public.wire_package_lines WHERE bill_id = r.bill_id AND is_open IS TRUE)) THEN
        v_kept := v_kept || jsonb_build_object('bill_id', r.bill_id, 'bill_number', (SELECT bill_number FROM public.vendor_bills WHERE id = r.bill_id),
                                               'why', CASE WHEN v_paid > 0 THEN 'money is recorded on it' ELSE 'it is on a wire' END);
        CONTINUE;
      END IF;
      UPDATE public.vendor_bills SET record_status = 'void', updated_at = now() WHERE id = r.bill_id;
      UPDATE public.company_bill_links SET status = 'void', cutoff_voided = true, updated_by = v_actor, updated_at = now() WHERE id = r.link_id;
      v_done := v_done || r.bill_id; v_total := v_total + coalesce(v_amt, 0);
    END LOOP;
  ELSE
    UPDATE public.company_ktc_bill_cutoff SET is_on = false, set_by = v_actor, set_at = now() WHERE company_id = v_company;
    FOR r IN SELECT l.id AS link_id, l.bill_id, l.source_bank_transaction_id AS line_id FROM public.company_bill_links l
              WHERE l.company_id = v_company AND l.status = 'void' AND l.cutoff_voided IS TRUE ORDER BY l.id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || r.line_id::text, 0));
      PERFORM 1 FROM public.company_bill_links WHERE id = r.link_id AND status = 'void' AND cutoff_voided IS TRUE FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      SELECT total_amount INTO v_amt FROM public.vendor_bills WHERE id = r.bill_id FOR UPDATE;
      UPDATE public.vendor_bills SET record_status = 'active', updated_at = now() WHERE id = r.bill_id AND record_status = 'void';
      UPDATE public.company_bill_links SET status = 'active', cutoff_voided = false, updated_by = v_actor, updated_at = now() WHERE id = r.link_id;
      v_done := v_done || r.bill_id; v_total := v_total + coalesce(v_amt, 0);
    END LOOP;
  END IF;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor,
    CASE WHEN v_on THEN 'nextrade_bill_cutoff_on' ELSE 'nextrade_bill_cutoff_off' END, 'company', v_company,
    jsonb_build_object('cutoff_date', v_date, 'bills', to_jsonb(v_done), 'count', coalesce(array_length(v_done, 1), 0), 'total', round(v_total, 2), 'kept', v_kept));
  RETURN jsonb_build_object('ok', true, 'on', v_on, 'cutoff_date', v_date, 'count', coalesce(array_length(v_done, 1), 0), 'total', round(v_total, 2), 'kept', v_kept);
END $$;
REVOKE ALL ON FUNCTION public.hub_company_bill_cutoff(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_company_bill_cutoff(jsonb) TO service_role;
SELECT 'v55.83-XN installed' AS done, (SELECT count(*) FROM public.company_bill_links) AS links_kept;
