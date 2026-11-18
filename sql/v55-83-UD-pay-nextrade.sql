-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UD — PAYING NEXTRADE (and RTM) (Max, Nov 18 2026)
-- 1. ONE step for a payment KTC sent to NextTrade / RTM: tick which of their bills it pays, plus an extra fee and / or an
--    advance. Everything is saved together or not at all, under the same locks as before (nobody can spend the payment twice).
--    The payment, its bank account and every bill must be KTC's own.
-- 2. STARTING BALANCE: money NextTrade / RTM already HOLD FOR KTC from before the Hub (not NextTrade's own bank balance). It joins
--    their advance so their bills can be paid from it. Super admin only, with where it comes from, an as-of date before any payment
--    already split into the advance, and an explicit choice whether staff may see it. A correction is a new entry linked to it.
-- 3. WAREHOUSE STAFF payroll on the Nextrade books now makes a KTC bill (KTC pays it). Any category can be set the same way.
-- Needs sql/v55-83-TV-TW-TX-all-in-one.sql and sql/v55-83-UB-company-transfers.sql first. Adds a table, columns and functions only.
-- Nothing is deleted. Safe to re-run.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 3. "KTC pays this" on a category (NULL = the old rule: expenses make a KTC bill, payroll does not)
ALTER TABLE public.company_categories ADD COLUMN IF NOT EXISTS makes_ktc_bill boolean;
UPDATE public.company_categories SET makes_ktc_bill = true WHERE company_id = 'NEXTRADE_BOOKS' AND key = 'payroll' AND makes_ktc_bill IS NULL;

-- the categorize function again (from UB), now reading makes_ktc_bill — everything else unchanged
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
  SELECT id, wave_business_id, direction, amount_abs, company_category, transfer_group_id INTO v_line FROM public.bank_transactions WHERE id = (p->>'line_id')::uuid FOR UPDATE;
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
REVOKE ALL ON FUNCTION public.hub_party_pool_restricted(text, text[]) FROM PUBLIC, anon, authenticated;

-- p: { party, amount (+ adds, − corrects), as_of, reason, visible_to_staff (true / false — required), corrects (the entry a minus
--      amount corrects), actor, request_id }
CREATE OR REPLACE FUNCTION public.hub_party_opening(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_party text := p->>'party'; v_actor uuid := nullif(p->>'actor', '')::uuid; v_req text := nullif(p->>'request_id', '');
  v_amt numeric := round(coalesce((p->>'amount')::numeric, 0), 2); v_reason text := trim(coalesce(p->>'reason', ''));
  v_asof date := coalesce(nullif(p->>'as_of', '')::date, (now() AT TIME ZONE 'America/New_York')::date); v_adv numeric; v_old record;
  v_vis text := p->>'visible_to_staff'; v_corr uuid := nullif(p->>'corrects', '')::uuid; v_orig record; v_fp text; v_first date; v_res jsonb; v_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties WHERE name = v_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company %.', v_party; END IF;
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: missing click id — refresh and try again.'; END IF;
  IF v_amt = 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount.'; END IF;
  IF v_vis IS NULL OR v_vis NOT IN ('true', 'false') THEN RAISE EXCEPTION 'HUB_GUARD: say whether staff may see this balance.'; END IF;
  IF length(v_reason) < 10 THEN RAISE EXCEPTION 'HUB_GUARD: say where this balance comes from (at least a short sentence).'; END IF;
  IF v_asof > (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'HUB_GUARD: the as-of date cannot be in the future.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || v_party, 0));
  v_fp := 'opening|' || v_party || '|' || v_amt::text || '|' || v_asof::text || '|' || v_vis || '|' || coalesce(v_corr::text, '');
  SELECT fingerprint, result INTO v_old FROM public.hub_party_requests WHERE request_id = v_req;
  IF FOUND THEN
    IF v_old.fingerprint <> v_fp THEN RAISE EXCEPTION 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.'; END IF;
    RETURN coalesce(v_old.result, '{}'::jsonb) || jsonb_build_object('ok', true, 'repeat', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.party_money_entries WHERE request_id = v_req) OR EXISTS (SELECT 1 FROM public.vendor_bill_payments WHERE request_id = v_req) THEN
    RAISE EXCEPTION 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.';
  END IF;
  IF v_amt < 0 THEN
    -- a correction names the starting balance it corrects (same company), so it can always be traced back
    SELECT id, party, kind, amount INTO v_orig FROM public.party_money_entries WHERE id = v_corr;
    IF v_orig.id IS NULL OR v_orig.party <> v_party OR v_orig.kind <> 'opening_balance' OR v_orig.amount <= 0 THEN
      RAISE EXCEPTION 'HUB_GUARD: a correction must name the starting balance it corrects.';
    END IF;
    IF (SELECT coalesce(sum(amount), 0) FROM public.party_money_entries WHERE id = v_corr OR corrects_id = v_corr) + v_amt < -0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: a correction cannot be more than that starting balance.';
    END IF;
  ELSIF v_corr IS NOT NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: only a minus amount corrects an earlier starting balance.';
  ELSE
    -- cut-off: money already split into the advance from a payment the Hub has must not be entered again as a starting balance
    SELECT min(coalesce(b.posted_date, b.date)) INTO v_first FROM public.party_money_entries e JOIN public.bank_transactions b ON b.id = e.bank_transaction_id
      WHERE e.party = v_party AND e.kind = 'payment_split' AND e.bucket = 'advance';
    IF v_first IS NOT NULL AND v_asof >= v_first THEN
      RAISE EXCEPTION 'HUB_GUARD: payments from % on are already in the % advance — the starting balance must be as of a date before that (%), so the same money is never counted twice.', v_first, v_party, v_first;
    END IF;
  END IF;
  INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, entry_date, reason, request_id, created_by, is_private, corrects_id)
    VALUES (v_party, 'advance', v_amt, 'opening_balance', gen_random_uuid(), v_asof, v_reason, v_req, v_actor, v_vis = 'false', v_corr) RETURNING id INTO v_id;
  SELECT coalesce(sum(amount), 0) INTO v_adv FROM public.party_money_entries WHERE party = v_party AND bucket = 'advance';
  IF v_adv < -0.005 THEN RAISE EXCEPTION 'HUB_GUARD: that would take the % advance below zero (it is % before this).', v_party, round(v_adv - v_amt, 2); END IF;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'party_opening_balance', 'party', v_party,
    jsonb_build_object('entry_id', v_id, 'amount', v_amt, 'as_of', v_asof, 'reason', v_reason, 'visible_to_staff', v_vis = 'true', 'corrects', v_corr, 'advance_after', round(v_adv, 2), 'request_id', v_req));
  v_res := jsonb_build_object('ok', true, 'entry_id', v_id, 'advance_balance', round(v_adv, 2));
  INSERT INTO public.hub_party_requests (request_id, action, party, fingerprint, result, created_by) VALUES (v_req, 'opening', v_party, v_fp, v_res, v_actor);
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.hub_party_opening(jsonb) FROM PUBLIC, anon, authenticated;

-- 1. ONE step for a payment to NextTrade / RTM: bills it pays + extra fee + advance, together or not at all.
-- p: { party, ktc_business (the KTC business id, set by the Hub server), bank_transaction_id, bills: [{bill_id, amount}], fee, advance,
--      reason, actor, request_id, hidden_accounts, restricted }
-- Lock order (same as TX / TO): company → bank line (advisory, then the row) → each bill in id order (advisory, then the row).
CREATE OR REPLACE FUNCTION public.hub_party_allocate(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_party text := p->>'party'; v_actor uuid := nullif(p->>'actor', '')::uuid; v_req text := nullif(p->>'request_id', '');
  v_ktc text := nullif(p->>'ktc_business', '');
  v_txn uuid := nullif(p->>'bank_transaction_id', '')::uuid; v_fee numeric := round(coalesce((p->>'fee')::numeric, 0), 2);
  v_advamt numeric := round(coalesce((p->>'advance')::numeric, 0), 2); v_reason text := nullif(trim(coalesce(p->>'reason', '')), '');
  v_hidden text[] := CASE WHEN p ? 'hidden_accounts' AND jsonb_typeof(p->'hidden_accounts') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p->'hidden_accounts')) ELSE NULL END;
  v_restricted boolean; v_line record; v_acc record; v_bill record; v_b record; v_used numeric; v_split numeric; v_bills_sum numeric := 0;
  v_open numeric; v_action uuid := gen_random_uuid(); v_n int := 0; v_fp text; v_old record; v_adv numeric; v_feeb numeric; v_hide boolean; v_res jsonb;
BEGIN
  v_restricted := v_hidden IS NOT NULL OR coalesce((p->>'restricted')::boolean, false);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_ktc IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the KTC business is not known — nothing was changed.'; END IF;
  IF v_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties WHERE name = v_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company %.', v_party; END IF;
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: missing click id — refresh and try again.'; END IF;
  IF v_txn IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the payment (bank line).'; END IF;
  IF v_fee < 0 OR v_advamt < 0 THEN RAISE EXCEPTION 'HUB_GUARD: the fee and the advance cannot be below zero.'; END IF;
  IF p ? 'bills' AND jsonb_typeof(p->'bills') <> 'array' THEN RAISE EXCEPTION 'HUB_GUARD: the bill list is not readable.'; END IF;
  -- the requested bills, one row each, rounded, in id order (that is also the lock order)
  CREATE TEMP TABLE IF NOT EXISTS hub_alloc_req (bill_id uuid, amount numeric) ON COMMIT DROP;
  DELETE FROM hub_alloc_req;
  INSERT INTO hub_alloc_req SELECT (x->>'bill_id')::uuid, round((x->>'amount')::numeric, 2) FROM jsonb_array_elements(coalesce(p->'bills', '[]'::jsonb)) x;
  IF EXISTS (SELECT 1 FROM hub_alloc_req WHERE bill_id IS NULL OR amount IS NULL OR amount <= 0) THEN RAISE EXCEPTION 'HUB_GUARD: every ticked bill needs an amount above zero.'; END IF;
  IF (SELECT count(*) FROM hub_alloc_req) <> (SELECT count(DISTINCT bill_id) FROM hub_alloc_req) THEN RAISE EXCEPTION 'HUB_GUARD: a bill is listed twice.'; END IF;
  IF (SELECT count(*) FROM hub_alloc_req) > 200 THEN RAISE EXCEPTION 'HUB_GUARD: at most 200 bills in one step.'; END IF;
  SELECT coalesce(sum(amount), 0), count(*) INTO v_bills_sum, v_n FROM hub_alloc_req;
  IF v_bills_sum + v_fee + v_advamt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: tick a bill, or type a fee or an advance.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || v_party, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_txn::text, 0));
  -- the same click again → the first result; the click id used for a different move (any field, the company included) → refused
  v_fp := 'allocate|' || v_party || '|' || v_txn::text || '|' || v_fee::text || '|' || v_advamt::text || '|' ||
    coalesce((SELECT string_agg(bill_id::text || ':' || amount::text, ',' ORDER BY bill_id) FROM hub_alloc_req), '');
  SELECT fingerprint, result INTO v_old FROM public.hub_party_requests WHERE request_id = v_req;
  IF FOUND THEN
    IF v_old.fingerprint <> v_fp THEN RAISE EXCEPTION 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.'; END IF;
    RETURN jsonb_build_object('ok', true, 'repeat', true, 'bills_paid', v_old.result->'bills_paid', 'left_on_payment', v_old.result->'left_on_payment');
  END IF;
  IF EXISTS (SELECT 1 FROM public.party_money_entries WHERE request_id = v_req) OR EXISTS (SELECT 1 FROM public.vendor_bill_payments WHERE request_id = v_req) THEN
    RAISE EXCEPTION 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.';
  END IF;

  -- the payment: locked as a row too, so nobody can re-mark it to another company while this step runs
  SELECT id, amount_abs, direction, wave_business_id, third_party_payer, pending, account_id, date INTO v_line FROM public.bank_transactions WHERE id = v_txn FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank line was not found.'; END IF;
  IF v_line.wave_business_id IS DISTINCT FROM v_ktc THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is not a KTC line.'; END IF;
  IF v_line.direction <> 'out' OR v_line.pending IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: only a settled money-out line can pay % bills.', v_party; END IF;
  IF lower(coalesce(v_line.third_party_payer, '')) <> lower(v_party) THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is not marked as a payment to %.', v_party; END IF;
  -- its bank account: must exist and be KTC's (for everyone); privacy read RIGHT NOW for a restricted caller (share lock)
  SELECT plaid_account_id, wave_business_id, coalesce(is_private, false) AS is_private INTO v_acc FROM public.plaid_accounts WHERE plaid_account_id = v_line.account_id FOR SHARE;
  IF v_line.account_id IS NULL OR v_acc.plaid_account_id IS NULL OR v_acc.wave_business_id IS DISTINCT FROM v_ktc THEN
    RAISE EXCEPTION 'HUB_GUARD: that payment is not in one of KTC''s own bank accounts.';
  END IF;
  IF v_restricted THEN
    IF v_acc.is_private OR v_line.account_id = ANY (coalesce(v_hidden, ARRAY[]::text[])) THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is in a private account.'; END IF;
    IF (v_fee > 0 OR v_advamt > 0) AND public.hub_party_pool_restricted(v_party, coalesce(v_hidden, ARRAY[]::text[])) THEN
      RAISE EXCEPTION 'HUB_GUARD: %''s advance includes money from a private account — only someone allowed to see private accounts can add to it.', v_party;
    END IF;
  END IF;

  -- each bill: locked in id order, KTC's, open, theirs, not paid beyond what is still open
  FOR v_b IN SELECT bill_id, amount FROM hub_alloc_req ORDER BY bill_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || v_b.bill_id::text, 0));
    SELECT id, record_status, paid_via, total_amount, bill_number, wave_business_id INTO v_bill FROM public.vendor_bills WHERE id = v_b.bill_id FOR UPDATE;
    IF v_bill.id IS NULL OR v_bill.record_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: one of the ticked bills is no longer open.'; END IF;
    IF v_bill.wave_business_id IS DISTINCT FROM v_ktc THEN RAISE EXCEPTION 'HUB_GUARD: bill % is not a KTC bill.', v_bill.bill_number; END IF;
    IF lower(coalesce(v_bill.paid_via, '')) <> lower(v_party) THEN RAISE EXCEPTION 'HUB_GUARD: bill % is not paid via % — only their bills can be paid here.', v_bill.bill_number, v_party; END IF;
    SELECT v_bill.total_amount - coalesce(sum(amount), 0) INTO v_open FROM public.vendor_bill_payments WHERE bill_id = v_b.bill_id AND voided IS NOT TRUE;
    IF v_b.amount > v_open + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: bill % has only % still open — cannot pay %.', v_bill.bill_number, round(v_open, 2), v_b.amount; END IF;
  END LOOP;

  -- the payment can never be spent twice: bills already paid from it + earlier fee / advance splits + wire fees + this step
  SELECT coalesce(sum(amount), 0) INTO v_used FROM public.vendor_bill_payments WHERE bank_transaction_id = v_txn AND voided IS NOT TRUE;
  SELECT coalesce(sum(amount), 0) INTO v_split FROM public.party_money_entries WHERE bank_transaction_id = v_txn AND kind = 'payment_split';
  IF to_regclass('public.wire_packages') IS NOT NULL THEN
    v_split := v_split + coalesce((SELECT sum(fee_amount) FROM public.wire_packages WHERE bank_transaction_id = v_txn AND status = 'attached' AND fee_amount > 0), 0);
  END IF;
  IF v_used + v_split + v_bills_sum + v_fee + v_advamt > v_line.amount_abs + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: the payment is %; already used %, this step % — over by %.', round(v_line.amount_abs, 2), round(v_used + v_split, 2), round(v_bills_sum + v_fee + v_advamt, 2), round(v_used + v_split + v_bills_sum + v_fee + v_advamt - v_line.amount_abs, 2);
  END IF;

  INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by, request_id)
    SELECT bill_id, amount, v_line.date, v_txn, 'rtm', v_actor, v_req FROM hub_alloc_req ORDER BY bill_id;
  IF v_fee > 0 THEN INSERT INTO public.party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, reason, request_id, created_by) VALUES (v_party, 'fee', v_fee, 'payment_split', v_txn, v_action, v_reason, v_req, v_actor); END IF;
  IF v_advamt > 0 THEN INSERT INTO public.party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, reason, request_id, created_by) VALUES (v_party, 'advance', v_advamt, 'payment_split', v_txn, v_action, v_reason, v_req, v_actor); END IF;
  SELECT coalesce(sum(amount) FILTER (WHERE bucket = 'advance'), 0), coalesce(sum(amount) FILTER (WHERE bucket = 'fee'), 0) INTO v_adv, v_feeb FROM public.party_money_entries WHERE party = v_party;
  -- (Codex 11:40) a restricted caller never gets the totals of a pool that holds money they may not see — even on a bills-only step
  v_hide := v_restricted AND public.hub_party_pool_restricted(v_party, coalesce(v_hidden, ARRAY[]::text[]));
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'party_payment_allocated', 'bank_transaction', v_txn::text,
    jsonb_build_object('party', v_party, 'bills', (SELECT jsonb_agg(jsonb_build_object('bill_id', bill_id, 'amount', amount)) FROM hub_alloc_req), 'fee', v_fee, 'advance', v_advamt, 'reason', v_reason, 'request_id', v_req));
  v_res := jsonb_build_object('ok', true, 'bills_paid', v_n, 'bills_amount', round(v_bills_sum, 2), 'fee', v_fee, 'advance', v_advamt,
    'left_on_payment', round(v_line.amount_abs - v_used - v_split - v_bills_sum - v_fee - v_advamt, 2));
  INSERT INTO public.hub_party_requests (request_id, action, party, fingerprint, result, created_by) VALUES (v_req, 'allocate', v_party, v_fp, v_res, v_actor);
  RETURN v_res || CASE WHEN v_hide THEN jsonb_build_object('balance_hidden', true) ELSE jsonb_build_object('advance_balance', round(v_adv, 2), 'fee_total', round(v_feeb, 2)) END;
END $$;
REVOKE ALL ON FUNCTION public.hub_party_allocate(jsonb) FROM PUBLIC, anon, authenticated;

-- the Hub checks this before offering the UD steps
CREATE OR REPLACE FUNCTION public.hub_party_ud_installed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_party_allocate')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_party_opening')
     AND to_regclass('public.hub_party_requests') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'party_money_entries' AND column_name = 'corrects_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_categories' AND column_name = 'makes_ktc_bill');
$$;
REVOKE ALL ON FUNCTION public.hub_party_ud_installed() FROM PUBLIC, anon;

-- check: select company_id, key, label, is_payroll, makes_ktc_bill from company_categories order by company_id, sort;
