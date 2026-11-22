-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-XO — THE STARTING BALANCE WITH NEXTTRADE / RTM (Max, 21-22 Nov 2026)
--   Max: "i need to have a previous balance to nextrade that we will pay bills from - We had sent to them previously that
--   they have funds for." Using it: "b - NEW EXPENSE WHEN USED AFTER 6/1/2026".
--   1. party_opening_balances: the money a company already held for KTC before the Hub (no bank line of ours shows it).
--      Append-only. A mistake is fixed by a CORRECTION: a minus amount that names the balance it corrects, and that can
--      never take the balance below what is already used on bills.
--   2. vendor_bill_payments.party_opening_id: a bill payment paid OUT OF a starting balance. A payment comes EITHER from a
--      bank line (bank_transaction_id) OR from a starting balance (party_opening_id) — never both.
--   3. hub_party_opening_state(id): amount (with corrections), used (live payments), held. ONE calculation.
--   4. hub_party_opening_add(p): add a starting balance or a correction. One click id = one result. Audited.
--   5. hub_party_opening_pay(p): pay KTC bills from a starting balance, dated 1 June 2026 or later (Max's rule), not before
--      the balance's as-of date, not in the future, not in a closed month (unless the Hub server says the person may).
--   6. A deferred check on every bill payment: never both sources, never more than the balance holds, never dated before
--      1 June 2026 or before the as-of date, and the bill is marked paid through that company.
-- Builds ONLY new things: one table, one column, functions and triggers of its own. It does NOT redefine any WF / UD / US /
-- TO function or constraint, changes no existing row, deletes nothing. The old UD starting balance (hub_party_opening, kind
-- 'opening_balance') stays switched off and is not used.
-- Needs (already installed): TO payment guards, UD (hub_party_requests), US partial wires, WF funds with RTM / NextTrade.
-- Safe to run more than once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. the starting balances (one row per balance; a correction is its own row that names the balance)
CREATE TABLE IF NOT EXISTS public.party_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party text NOT NULL,
  amount numeric NOT NULL CHECK (amount <> 0 AND amount = round(amount, 2)),
  as_of date NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  visible_to_staff boolean NOT NULL,
  corrects_id uuid REFERENCES public.party_opening_balances(id),
  request_id text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_opening_balances_sign CHECK ((amount > 0 AND corrects_id IS NULL) OR (amount < 0 AND corrects_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS party_opening_balances_party ON public.party_opening_balances (party);
CREATE INDEX IF NOT EXISTS party_opening_balances_corrects ON public.party_opening_balances (corrects_id) WHERE corrects_id IS NOT NULL;
ALTER TABLE public.party_opening_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.party_opening_balances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.party_opening_balances TO service_role; -- the Hub server reads it; it writes ONLY through the functions below

-- 2. a bill payment paid out of a starting balance
ALTER TABLE public.vendor_bill_payments ADD COLUMN IF NOT EXISTS party_opening_id uuid REFERENCES public.party_opening_balances(id);
CREATE INDEX IF NOT EXISTS vendor_bill_payments_party_opening ON public.vendor_bill_payments (party_opening_id) WHERE party_opening_id IS NOT NULL;

-- 3. THE ONE CALCULATION of a starting balance. A correction's id answers for the balance it corrects.
--    amount = the balance + its corrections · used = live bill payments from it · held = amount − used
CREATE OR REPLACE FUNCTION public.hub_party_opening_state(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE o record; v_corr numeric; v_nc int; v_used numeric; v_np int; v_amt numeric;
BEGIN
  SELECT b.id, b.party, b.amount, b.as_of, b.visible_to_staff, b.corrects_id INTO o FROM public.party_opening_balances b WHERE b.id = p_id;
  IF o.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  IF o.corrects_id IS NOT NULL THEN
    SELECT b.id, b.party, b.amount, b.as_of, b.visible_to_staff, b.corrects_id INTO o FROM public.party_opening_balances b WHERE b.id = o.corrects_id;
  END IF;
  SELECT coalesce(sum(round(c.amount, 2)), 0), count(*) INTO v_corr, v_nc FROM public.party_opening_balances c WHERE c.corrects_id = o.id;
  v_amt := round(o.amount, 2) + v_corr;
  SELECT coalesce(sum(round(p.amount, 2)), 0), count(*) INTO v_used, v_np FROM public.vendor_bill_payments p WHERE p.party_opening_id = o.id AND p.voided IS NOT TRUE;
  RETURN jsonb_build_object('found', true, 'id', o.id, 'party', o.party, 'as_of', o.as_of, 'visible_to_staff', o.visible_to_staff,
    'original', round(o.amount, 2), 'corrections', v_corr, 'corrections_count', v_nc, 'amount', v_amt, 'used', v_used, 'payments', v_np, 'held', v_amt - v_used);
END $fn$;

-- 4. what a NEW starting-balance row may be (whoever writes it). The table is append-only: no change, no delete, no truncate.
CREATE OR REPLACE FUNCTION public.hub_party_opening_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE o record; v_after numeric; v_used numeric;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'HUB_GUARD: a starting balance is never changed or deleted — add a correction (a minus amount that names it) instead.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paid_through_parties x WHERE x.name = NEW.party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || NEW.party, 0)); -- the same company lock every payment from it takes
  IF NEW.amount < 0 THEN
    SELECT b.id, b.party, b.amount, b.as_of, b.visible_to_staff, b.corrects_id INTO o FROM public.party_opening_balances b WHERE b.id = NEW.corrects_id;
    IF o.id IS NULL OR o.corrects_id IS NOT NULL OR o.amount <= 0 OR o.party <> NEW.party THEN
      RAISE EXCEPTION 'HUB_GUARD: a correction must name a starting balance of the same company.';
    END IF;
    NEW.as_of := o.as_of; NEW.visible_to_staff := o.visible_to_staff; -- a correction belongs to its balance: same date, same visibility
    SELECT coalesce(sum(round(c.amount, 2)), 0) INTO v_after FROM public.party_opening_balances c WHERE c.corrects_id = o.id;
    v_after := round(o.amount, 2) + v_after + round(NEW.amount, 2);
    SELECT coalesce(sum(round(p.amount, 2)), 0) INTO v_used FROM public.vendor_bill_payments p WHERE p.party_opening_id = o.id AND p.voided IS NOT TRUE;
    IF v_after < v_used - 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: this correction would leave the starting balance at $% but $% of it is already used on bills. Correct it by at most $%, or undo a bill payment first.',
        to_char(v_after, 'FM999,999,990.00'), to_char(v_used, 'FM999,999,990.00'), to_char(greatest(v_after - round(NEW.amount, 2) - v_used, 0), 'FM999,999,990.00');
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS hub_party_opening_rules ON public.party_opening_balances;
CREATE TRIGGER hub_party_opening_rules BEFORE INSERT OR UPDATE OR DELETE ON public.party_opening_balances FOR EACH ROW EXECUTE FUNCTION public.hub_party_opening_rules();
DROP TRIGGER IF EXISTS hub_party_opening_no_truncate ON public.party_opening_balances;
CREATE TRIGGER hub_party_opening_no_truncate BEFORE TRUNCATE ON public.party_opening_balances FOR EACH STATEMENT EXECUTE FUNCTION public.hub_party_opening_rules();

-- 5. a payment from a starting balance takes the company lock FIRST (before any bill lock — this trigger's name sorts before
--    hub_bill_payment_cap on purpose), the same order as hub_party_opening_pay: company → bills
CREATE OR REPLACE FUNCTION public.hub_party_opening_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_party text;
BEGIN
  IF NEW.party_opening_id IS NOT NULL THEN
    SELECT b.party INTO v_party FROM public.party_opening_balances b WHERE b.id = NEW.party_opening_id;
    IF v_party IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || v_party, 0)); END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS hub_a_opening_lock ON public.vendor_bill_payments;
CREATE TRIGGER hub_a_opening_lock BEFORE INSERT OR UPDATE ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.hub_party_opening_lock();

-- 6. EVERY bill payment, whoever writes it, checked at the END of its step (the row as it then stands):
--    never both sources · from a starting balance: dated 1 June 2026 or later and not before its as-of date, the bill marked
--    paid through that company, and the balance never used beyond what it holds (with its corrections).
CREATE OR REPLACE FUNCTION public.hub_party_opening_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE r record; o record; s jsonb; v_via text;
BEGIN
  SELECT p.id, p.bill_id, p.amount, p.paid_date, p.voided, p.bank_transaction_id, p.party_opening_id INTO r FROM public.vendor_bill_payments p WHERE p.id = NEW.id;
  IF r.id IS NULL OR r.party_opening_id IS NULL THEN RETURN NULL; END IF;
  IF r.bank_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: a bill payment comes EITHER from a bank line OR from a starting balance — never both. Nothing was recorded.';
  END IF;
  IF r.voided IS TRUE THEN RETURN NULL; END IF; -- undoing a payment gives the money back to the balance: always allowed
  SELECT b.id, b.party, b.as_of, b.corrects_id INTO o FROM public.party_opening_balances b WHERE b.id = r.party_opening_id;
  IF o.id IS NULL OR o.corrects_id IS NOT NULL THEN RAISE EXCEPTION 'HUB_GUARD: a bill is paid from the starting balance itself, not from a correction of it.'; END IF;
  IF r.paid_date < DATE '2026-06-01' THEN
    RAISE EXCEPTION 'HUB_GUARD: bills are paid from a starting balance on 1 June 2026 or later (using it is a new expense from that date). Nothing was recorded.';
  END IF;
  IF r.paid_date < o.as_of THEN RAISE EXCEPTION 'HUB_GUARD: this starting balance is as of % — it cannot pay a bill on an earlier date (%).', o.as_of, r.paid_date; END IF;
  SELECT vb.paid_via INTO v_via FROM public.vendor_bills vb WHERE vb.id = r.bill_id;
  IF lower(trim(coalesce(v_via, ''))) <> lower(o.party) THEN RAISE EXCEPTION 'HUB_GUARD: that bill is not marked as paid through % — a starting balance of % pays only its bills.', o.party, o.party; END IF;
  s := public.hub_party_opening_state(o.id);
  IF (s->>'held')::numeric < -0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: this would use more than the $% starting balance with % holds (already used $%) — over by $%. Nothing was recorded.',
      to_char((s->>'amount')::numeric, 'FM999,999,990.00'), o.party, to_char((s->>'used')::numeric - round(r.amount, 2), 'FM999,999,990.00'), to_char(-(s->>'held')::numeric, 'FM999,999,990.00');
  END IF;
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS hub_party_opening_guard ON public.vendor_bill_payments;
CREATE CONSTRAINT TRIGGER hub_party_opening_guard AFTER INSERT OR UPDATE ON public.vendor_bill_payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_party_opening_guard();

-- 7. ADD A STARTING BALANCE (or a correction). The Hub server checks who (super admin). One click id = one result.
--    p: { party, amount (+ a balance / − a correction), as_of, reason (≥ 10 characters: where the number comes from),
--         visible_to_staff (true / false — required for a balance), corrects_id (a correction), actor, request_id }
CREATE OR REPLACE FUNCTION public.hub_party_opening_add(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_party text := nullif(trim(coalesce(p->>'party', '')), ''); v_amt numeric := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
  v_asof date := nullif(p->>'as_of', '')::date; v_reason text := nullif(left(trim(coalesce(p->>'reason', '')), 500), '');
  v_vis text := lower(coalesce(p->>'visible_to_staff', '')); v_corr uuid := nullif(p->>'corrects_id', '')::uuid;
  v_actor uuid := nullif(p->>'actor', '')::uuid; v_req text := nullif(trim(coalesce(p->>'request_id', '')), '');
  v_today date := (now() AT TIME ZONE 'America/New_York')::date; v_fp text; v_old record; v_id uuid; v_res jsonb; v_before jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties x WHERE x.name = v_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company.'; END IF;
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: missing click id — refresh and try again.'; END IF;
  IF v_amt = 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount (above zero for a starting balance; a minus amount corrects one).'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 10 THEN RAISE EXCEPTION 'HUB_GUARD: say where this number comes from (at least 10 characters).'; END IF;
  IF v_amt > 0 THEN
    IF v_corr IS NOT NULL THEN RAISE EXCEPTION 'HUB_GUARD: only a minus amount corrects a starting balance.'; END IF;
    IF v_asof IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: type the date this balance is as of.'; END IF;
    IF v_asof > v_today THEN RAISE EXCEPTION 'HUB_GUARD: the as-of date cannot be in the future.'; END IF;
    IF v_vis NOT IN ('true', 'false') THEN RAISE EXCEPTION 'HUB_GUARD: say whether staff may see this balance.'; END IF;
  ELSIF v_corr IS NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: a minus amount is a correction — pick the starting balance it corrects.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || v_party, 0));
  v_fp := md5(concat_ws('|', 'opening_add', lower(v_party), v_amt::text, coalesce(v_asof::text, ''), v_reason, v_vis, coalesce(v_corr::text, '')));
  SELECT r.request_id, r.fingerprint, r.result INTO v_old FROM public.hub_party_requests r WHERE r.request_id = v_req;
  IF v_old.request_id IS NOT NULL THEN
    IF v_old.fingerprint = v_fp THEN RETURN v_old.result || jsonb_build_object('repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: that click was already used for something else — refresh and try again.';
  END IF;
  IF v_corr IS NOT NULL THEN v_before := public.hub_party_opening_state(v_corr); END IF;
  -- a correction takes its balance's date and visibility (the rules trigger sets them; the row checks refuse anything else)
  INSERT INTO public.party_opening_balances (party, amount, as_of, reason, visible_to_staff, corrects_id, request_id, created_by)
  VALUES (v_party, v_amt, coalesce(v_asof, v_today), v_reason, v_vis = 'true', v_corr, v_req, v_actor) RETURNING id INTO v_id;
  v_res := jsonb_build_object('ok', true, 'action', CASE WHEN v_amt > 0 THEN 'opening_add' ELSE 'opening_correct' END, 'id', v_id, 'state', public.hub_party_opening_state(v_id));
  INSERT INTO public.hub_party_requests (request_id, action, party, fingerprint, result, created_by) VALUES (v_req, 'opening_add', v_party, v_fp, v_res, v_actor);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, CASE WHEN v_amt > 0 THEN 'party_starting_balance' ELSE 'party_starting_balance_correction' END,
    'party_opening_balance', coalesce(v_corr, v_id)::text, jsonb_build_object('party', v_party, 'row_id', v_id, 'amount', v_amt, 'as_of', v_asof, 'reason', v_reason,
    'visible_to_staff', v_vis = 'true', 'corrects_id', v_corr, 'request_id', v_req, 'before', v_before, 'after', v_res->'state'));
  RETURN v_res;
END $fn$;

-- 8. PAY KTC BILLS FROM A STARTING BALANCE (Max's (b): a new expense when used, on or after 1 June 2026).
--    p: { party, opening_id, bills: [{ bill_id, amount }], paid_date, reference, reason, actor, request_id, allow_closed }
--    Locks: the company, then each bill in id order. No bank line is touched; the payment names the balance, not a bank line.
CREATE OR REPLACE FUNCTION public.hub_party_opening_pay(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_party text := nullif(trim(coalesce(p->>'party', '')), ''); v_open uuid := nullif(p->>'opening_id', '')::uuid;
  v_date date := nullif(p->>'paid_date', '')::date; v_ref text := nullif(left(trim(coalesce(p->>'reference', '')), 200), '');
  v_reason text := nullif(left(trim(coalesce(p->>'reason', '')), 300), ''); v_actor uuid := nullif(p->>'actor', '')::uuid;
  v_req text := nullif(trim(coalesce(p->>'request_id', '')), ''); v_closed_ok boolean := coalesce((p->>'allow_closed')::boolean, false);
  v_bills jsonb := coalesce(p->'bills', '[]'::jsonb); v_today date := (now() AT TIME ZONE 'America/New_York')::date;
  o record; b record; x record; s jsonb; v_fp text; v_old record; lock_through date; v_n int; v_ask numeric;
  v_ids uuid[] := ARRAY[]::uuid[]; v_pid uuid; v_total numeric := 0; v_paid numeric; v_wire numeric; v_left numeric; v_res jsonb; v_via_set int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties z WHERE z.name = v_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company.'; END IF;
  IF v_open IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the starting balance.'; END IF;
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: missing click id — refresh and try again.'; END IF;
  IF jsonb_typeof(v_bills) <> 'array' OR jsonb_array_length(v_bills) = 0 THEN RAISE EXCEPTION 'HUB_GUARD: pick at least one bill.'; END IF;
  IF v_date IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: type the date these bills are paid.'; END IF;
  IF v_date < DATE '2026-06-01' THEN
    RAISE EXCEPTION 'HUB_GUARD: bills are paid from a starting balance on 1 June 2026 or later (using it is a new expense from that date). Nothing was recorded.';
  END IF;
  IF v_date > v_today THEN RAISE EXCEPTION 'HUB_GUARD: the date cannot be in the future.'; END IF;
  IF v_ref IS NULL OR length(v_ref) < 3 THEN RAISE EXCEPTION 'HUB_GUARD: type the payment reference or where the proof is (at least 3 characters).'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN RAISE EXCEPTION 'HUB_GUARD: say why (a short reason).'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || v_party, 0));
  v_fp := md5(concat_ws('|', 'opening_pay', lower(v_party), v_open::text, v_date::text, v_ref, v_reason, v_bills::text));
  SELECT r.request_id, r.fingerprint, r.result INTO v_old FROM public.hub_party_requests r WHERE r.request_id = v_req;
  IF v_old.request_id IS NOT NULL THEN
    IF v_old.fingerprint = v_fp THEN RETURN v_old.result || jsonb_build_object('repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: that click was already used for something else — refresh and try again.';
  END IF;
  SELECT ob.id, ob.party, ob.as_of, ob.corrects_id INTO o FROM public.party_opening_balances ob WHERE ob.id = v_open;
  IF o.id IS NULL OR o.corrects_id IS NOT NULL OR lower(o.party) <> lower(v_party) THEN RAISE EXCEPTION 'HUB_GUARD: that is not a starting balance with %.', v_party; END IF;
  IF v_date < o.as_of THEN RAISE EXCEPTION 'HUB_GUARD: this starting balance is as of % — it cannot pay a bill on an earlier date (%).', o.as_of, v_date; END IF;
  IF to_regclass('clickbooks_us.books') IS NOT NULL AND NOT v_closed_ok THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO lock_through;
    IF lock_through IS NOT NULL AND v_date <= lock_through THEN
      RAISE EXCEPTION 'HUB_GUARD: % is inside a closed month (books are closed through %). Use a date in an open month, or reopen that month first (Accounting → Month-end).', v_date, lock_through;
    END IF;
  END IF;
  SELECT count(DISTINCT e->>'bill_id'), coalesce(sum(round((e->>'amount')::numeric, 2)), 0) INTO v_n, v_ask FROM jsonb_array_elements(v_bills) e;
  IF v_n <> jsonb_array_length(v_bills) THEN RAISE EXCEPTION 'HUB_GUARD: the same bill is listed twice.'; END IF;
  s := public.hub_party_opening_state(v_open);
  IF v_ask > (s->>'held')::numeric + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: these bills come to $% but only $% is left of the starting balance ($% less $% already used). Nothing was recorded.',
      to_char(v_ask, 'FM999,999,990.00'), to_char(greatest((s->>'held')::numeric, 0), 'FM999,999,990.00'), to_char((s->>'amount')::numeric, 'FM999,999,990.00'), to_char((s->>'used')::numeric, 'FM999,999,990.00');
  END IF;
  FOR x IN SELECT (e->>'bill_id')::uuid AS bill_id, round((e->>'amount')::numeric, 2) AS amount FROM jsonb_array_elements(v_bills) e ORDER BY (e->>'bill_id') LOOP
    IF x.amount IS NULL OR x.amount <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: every bill needs an amount above zero.'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || x.bill_id::text, 0));
    SELECT vb.id, vb.vendor_name, vb.bill_number, vb.total_amount, vb.record_status, nullif(trim(coalesce(vb.paid_via, '')), '') AS via,
           upper(coalesce(nullif(to_jsonb(vb)->>'currency', ''), 'USD')) AS cur INTO b FROM public.vendor_bills vb WHERE vb.id = x.bill_id FOR UPDATE;
    IF b.id IS NULL OR b.record_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'HUB_GUARD: a bill was not found or is not active.'; END IF;
    IF b.cur <> 'USD' THEN RAISE EXCEPTION 'HUB_GUARD: % % is in %; a starting balance is in US dollars — no conversion is made. Nothing was recorded.', coalesce(b.vendor_name, 'A bill'), coalesce(b.bill_number, ''), b.cur; END IF;
    IF b.via IS NOT NULL AND lower(b.via) <> lower(v_party) THEN RAISE EXCEPTION 'HUB_GUARD: % % is marked as paid through % — not %. Nothing was recorded.', coalesce(b.vendor_name, 'A bill'), coalesce(b.bill_number, ''), b.via, v_party; END IF;
    SELECT coalesce(sum(round(pp.amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments pp WHERE pp.bill_id = x.bill_id AND pp.voided IS NOT TRUE;
    SELECT coalesce(sum(round(l.amount, 2)), 0) INTO v_wire FROM public.wire_package_lines l WHERE l.bill_id = x.bill_id AND l.is_open IS TRUE;
    v_left := round(coalesce(b.total_amount, 0), 2) - v_paid - v_wire;
    IF x.amount > v_left + 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: % % has only $% open (total $%, paid $%, on open wires $%) — this asks $%. Nothing was recorded.', coalesce(b.vendor_name, 'A bill'), coalesce(b.bill_number, ''),
        to_char(greatest(v_left, 0), 'FM999,999,990.00'), to_char(round(coalesce(b.total_amount, 0), 2), 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00'), to_char(v_wire, 'FM999,999,990.00'), to_char(x.amount, 'FM999,999,990.00');
    END IF;
    IF b.via IS NULL THEN UPDATE public.vendor_bills SET paid_via = v_party WHERE id = x.bill_id; v_via_set := v_via_set + 1; END IF; -- paid through this company from now on
    INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, party_opening_id, method, created_by, request_id)
    VALUES (x.bill_id, x.amount, v_date, NULL, v_open, 'rtm', v_actor, v_req) RETURNING id INTO v_pid;
    v_ids := v_ids || v_pid; v_total := v_total + x.amount;
  END LOOP;
  v_res := jsonb_build_object('ok', true, 'action', 'opening_pay', 'payments', to_jsonb(v_ids), 'total', v_total, 'paid_date', v_date, 'state', public.hub_party_opening_state(v_open));
  INSERT INTO public.hub_party_requests (request_id, action, party, fingerprint, result, created_by) VALUES (v_req, 'opening_pay', v_party, v_fp, v_res, v_actor);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'party_starting_balance_used', 'party_opening_balance', v_open::text,
    jsonb_build_object('party', v_party, 'paid_date', v_date, 'reference', v_ref, 'reason', v_reason, 'bills', v_bills, 'payment_ids', to_jsonb(v_ids), 'total', v_total,
      'paid_via_set', v_via_set, 'closed_month_allowed', v_closed_ok, 'before', s));
  RETURN v_res;
END $fn$;

-- 9. installed? (the Hub server asks before it offers anything)
CREATE OR REPLACE FUNCTION public.hub_party_opening_installed() RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT to_regclass('public.party_opening_balances') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.vendor_bill_payments'::regclass AND a.attname = 'party_opening_id' AND NOT a.attisdropped)
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_party_opening_add')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_party_opening_pay')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_party_opening_state')
     AND EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'hub_party_opening_guard' AND t.tgenabled <> 'D')
     AND EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'hub_party_opening_rules' AND t.tgenabled <> 'D');
$fn$;

-- 10. only the Hub server
REVOKE ALL ON FUNCTION public.hub_party_opening_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_opening_add(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_opening_pay(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_opening_installed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_opening_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_opening_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_opening_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_party_opening_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_party_opening_add(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_party_opening_pay(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_party_opening_installed() TO service_role;

-- CHECK (read-only): every line must say OK
SELECT 'starting balances are kept, append-only (a mistake is a correction row)' AS check_item,
       CASE WHEN to_regclass('public.party_opening_balances') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'hub_party_opening_rules' AND t.tgenabled <> 'D')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'hub_party_opening_no_truncate' AND t.tgenabled <> 'D') THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'a bill payment comes from a bank line OR a starting balance, never both, never beyond the balance, dated 1 June 2026 or later',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'hub_party_opening_guard' AND t.tgenabled <> 'D' AND t.tgdeferrable AND t.tginitdeferred) THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'everything the Hub needs is installed', CASE WHEN public.hub_party_opening_installed() THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'only the Hub server can add or use a starting balance; browsers cannot read the table',
       CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_party_opening_add(jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hub_party_opening_add(jsonb)', 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', 'public.hub_party_opening_pay(jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hub_party_opening_pay(jsonb)', 'EXECUTE')
                 AND NOT has_table_privilege('authenticated', 'public.party_opening_balances', 'SELECT') AND NOT has_table_privilege('anon', 'public.party_opening_balances', 'SELECT')
                 AND has_function_privilege('service_role', 'public.hub_party_opening_pay(jsonb)', 'EXECUTE') AND has_table_privilege('service_role', 'public.party_opening_balances', 'SELECT')
                 AND NOT has_table_privilege('service_role', 'public.party_opening_balances', 'INSERT') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'the WF transfer calculation is untouched (it never reads starting balances)',
       CASE WHEN position('party_opening' in pg_get_functiondef('public.hub_party_transfer_state(uuid,uuid)'::regprocedure)) = 0 THEN 'OK' ELSE 'PROBLEM' END;
