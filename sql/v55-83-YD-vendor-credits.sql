-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v55.83-YD — VENDOR CREDIT MEMOS applied to bills (Max, 23 Nov 2026: "make sure we have ... credit memo for bills")
-- A vendor sends a credit memo: money KTC no longer owes that vendor. It is recorded ONCE, then applied to one or more open bills of
-- the SAME vendor (same company, same currency). An application lowers what that bill still owes; it is not a payment (no money
-- moved) and never makes a bill owe less than zero. Undo = the application is voided (kept, audited). Nothing is ever deleted.
-- The four existing caps (wire line, payment at once, payment at the end of the transaction, bank-line guard) and the bill void
-- guard count applied credits, under the SAME per-bill lock ('hub-bill:' + id), so pay / wire / credit at the same moment can never
-- together exceed the bill. Re-runnable. Only the Hub server (service_role) can write.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 0. the vendor part of the WZ identity (same normalisation: case, punctuation, Inc / LLC / Corp … ignored)
CREATE OR REPLACE FUNCTION public.hub_vendor_key(p_vendor text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT nullif(split_part(coalesce(public.hub_bill_number_key(p_vendor, 'X'), ''), '|', 1), '') $$;
REVOKE ALL ON FUNCTION public.hub_vendor_key(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_vendor_key(text) TO service_role;

-- 1. the credit memos
CREATE TABLE IF NOT EXISTS public.vendor_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_business_id text NOT NULL,
  vendor_name text NOT NULL CHECK (btrim(vendor_name) <> ''),
  credit_number text NOT NULL CHECK (btrim(credit_number) <> ''),
  credit_date date NOT NULL,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  category text,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  attachment_path text,
  record_status text NOT NULL DEFAULT 'active' CHECK (record_status IN ('active', 'void')),
  void_reason text, voided_by uuid, voided_at timestamptz,
  request_id text UNIQUE,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (record_status = 'active' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL))
);
-- one ACTIVE credit per vendor + number per company (a credit memo entered twice is refused)
CREATE UNIQUE INDEX IF NOT EXISTS vendor_credits_one_active ON public.vendor_credits (wave_business_id, public.hub_bill_number_key(vendor_name, credit_number)) WHERE record_status = 'active';

-- 2. what a credit is used for: applied to a BILL (lowers what it owes) or REFUNDED as money by the vendor (Codex 23 Nov: a cash
--    refund must use up the credit, or the same credit could still be applied to another bill). A refund names the money-in bank line
--    it arrived on; that line is then only this refund (one line, one refund, the whole line).
CREATE TABLE IF NOT EXISTS public.vendor_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES public.vendor_credits(id),
  kind text NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill', 'refund')),
  bill_id uuid REFERENCES public.vendor_bills(id),
  bank_transaction_id uuid,
  CHECK ((kind = 'bill' AND bill_id IS NOT NULL AND bank_transaction_id IS NULL) OR (kind = 'refund' AND bank_transaction_id IS NOT NULL AND bill_id IS NULL)),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  applied_date date NOT NULL,
  reason text,
  request_id text UNIQUE,
  applied_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  voided boolean NOT NULL DEFAULT false, void_reason text, voided_by uuid, voided_at timestamptz,
  CHECK (voided IS NOT TRUE OR (void_reason IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS vendor_credit_applications_bill ON public.vendor_credit_applications (bill_id) WHERE voided IS NOT TRUE;
CREATE INDEX IF NOT EXISTS vendor_credit_applications_credit ON public.vendor_credit_applications (credit_id) WHERE voided IS NOT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS vendor_credit_applications_refund_line ON public.vendor_credit_applications (bank_transaction_id) WHERE kind = 'refund' AND voided IS NOT TRUE;

-- idempotency fingerprints for the two writers (same click = same answer; a different request with the same id is refused)
CREATE TABLE IF NOT EXISTS public.hub_vendor_credit_requests (request_id text PRIMARY KEY, action text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE public.vendor_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_vendor_credit_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_credits, public.vendor_credit_applications, public.hub_vendor_credit_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vendor_credits, public.vendor_credit_applications TO service_role;

-- 3. nothing is deleted; amounts / bills / credits of an application never change after the fact (undo = void)
CREATE OR REPLACE FUNCTION public.hub_vendor_credit_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'HUB_GUARD: vendor credits and their applications are never deleted — void them instead.'; END $$;
DROP TRIGGER IF EXISTS hub_vendor_credit_no_delete ON public.vendor_credits;
CREATE TRIGGER hub_vendor_credit_no_delete BEFORE DELETE ON public.vendor_credits FOR EACH ROW EXECUTE FUNCTION public.hub_vendor_credit_no_delete();
DROP TRIGGER IF EXISTS hub_vendor_credit_no_delete ON public.vendor_credit_applications;
CREATE TRIGGER hub_vendor_credit_no_delete BEFORE DELETE ON public.vendor_credit_applications FOR EACH ROW EXECUTE FUNCTION public.hub_vendor_credit_no_delete();

CREATE OR REPLACE FUNCTION public.hub_vendor_credit_app_lock() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.credit_id <> OLD.credit_id OR NEW.kind <> OLD.kind OR NEW.bill_id IS DISTINCT FROM OLD.bill_id OR NEW.bank_transaction_id IS DISTINCT FROM OLD.bank_transaction_id
     OR NEW.amount <> OLD.amount OR NEW.applied_date <> OLD.applied_date THEN
    RAISE EXCEPTION 'HUB_GUARD: an applied credit cannot be changed — void it and apply again.'; END IF;
  IF OLD.voided IS TRUE AND NEW.voided IS NOT TRUE THEN RAISE EXCEPTION 'HUB_GUARD: a voided credit application stays voided — apply again instead.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hub_vendor_credit_app_lock ON public.vendor_credit_applications;
CREATE TRIGGER hub_vendor_credit_app_lock BEFORE UPDATE ON public.vendor_credit_applications FOR EACH ROW EXECUTE FUNCTION public.hub_vendor_credit_app_lock();

CREATE OR REPLACE FUNCTION public.hub_vendor_credit_lock() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.wave_business_id <> OLD.wave_business_id OR NEW.vendor_name <> OLD.vendor_name OR NEW.credit_number <> OLD.credit_number OR NEW.currency <> OLD.currency
     OR NEW.total_amount <> OLD.total_amount OR NEW.credit_date <> OLD.credit_date THEN
    RAISE EXCEPTION 'HUB_GUARD: a recorded credit memo cannot be changed — void it (when nothing is applied) and enter it again.'; END IF;
  IF OLD.record_status = 'void' AND NEW.record_status <> 'void' THEN RAISE EXCEPTION 'HUB_GUARD: a voided credit memo stays voided.'; END IF;
  IF OLD.record_status = 'active' AND NEW.record_status = 'void' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-credit:' || NEW.id::text, 0));
    IF EXISTS (SELECT 1 FROM public.vendor_credit_applications a WHERE a.credit_id = NEW.id AND a.voided IS NOT TRUE) THEN
      RAISE EXCEPTION 'HUB_GUARD: this credit memo is applied to a bill or recorded as refunded — undo those first.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hub_vendor_credit_lock ON public.vendor_credits;
CREATE TRIGGER hub_vendor_credit_lock BEFORE UPDATE ON public.vendor_credits FOR EACH ROW EXECUTE FUNCTION public.hub_vendor_credit_lock();

-- 4. what is applied to a bill / used from a credit (the ONE definition, used by every guard below)
CREATE OR REPLACE FUNCTION public.hub_bill_credits(p_bill uuid) RETURNS numeric LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(sum(round(a.amount, 2)), 0) FROM public.vendor_credit_applications a WHERE a.kind = 'bill' AND a.bill_id = p_bill AND a.voided IS NOT TRUE $$;
CREATE OR REPLACE FUNCTION public.hub_credit_used(p_credit uuid) RETURNS numeric LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(sum(round(a.amount, 2)), 0) FROM public.vendor_credit_applications a WHERE a.credit_id = p_credit AND a.voided IS NOT TRUE $$;
REVOKE ALL ON FUNCTION public.hub_bill_credits(uuid), public.hub_credit_used(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_bill_credits(uuid), public.hub_credit_used(uuid) TO service_role;

-- 5. record a credit memo (the Hub server only)
CREATE OR REPLACE FUNCTION public.hub_vendor_credit_create(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_req text := nullif(p->>'request_id', ''); v_fp text; v_old record; v_id uuid; v_res jsonb; v_amt numeric; v_dup uuid;
BEGIN
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a request id is required.'; END IF;
  v_amt := round((p->>'amount')::numeric, 2);
  v_fp := md5(concat_ws('|', 'create', p->>'wave_business_id', public.hub_bill_number_key(p->>'vendor_name', p->>'credit_number'), p->>'credit_date', upper(coalesce(p->>'currency', 'USD')), v_amt::text));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-credit-req:' || v_req, 0));
  SELECT * INTO v_old FROM public.hub_vendor_credit_requests WHERE request_id = v_req;
  IF FOUND THEN
    IF v_old.fingerprint = v_fp THEN RETURN v_old.result || jsonb_build_object('repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: that request id was already used for a different action.';
  END IF;
  IF public.hub_bill_number_key(p->>'vendor_name', p->>'credit_number') IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the vendor and the credit memo number are required.'; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: the credit amount must be above zero.'; END IF;
  IF length(btrim(coalesce(p->>'reason', ''))) < 3 THEN RAISE EXCEPTION 'HUB_GUARD: say why (the reason on the credit memo), in a few words.'; END IF;
  SELECT c.id INTO v_dup FROM public.vendor_credits c WHERE c.wave_business_id = p->>'wave_business_id' AND c.record_status = 'active'
    AND public.hub_bill_number_key(c.vendor_name, c.credit_number) = public.hub_bill_number_key(p->>'vendor_name', p->>'credit_number');
  IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'HUB_GUARD: credit memo % from % is already recorded — it is not entered twice.', p->>'credit_number', p->>'vendor_name'; END IF;
  INSERT INTO public.vendor_credits (wave_business_id, vendor_name, credit_number, credit_date, currency, total_amount, category, reason, attachment_path, request_id, created_by)
  VALUES (p->>'wave_business_id', btrim(p->>'vendor_name'), btrim(p->>'credit_number'), (p->>'credit_date')::date, upper(coalesce(nullif(p->>'currency', ''), 'USD')), v_amt,
          nullif(p->>'category', ''), btrim(coalesce(p->>'reason', '')), nullif(p->>'attachment_path', ''), v_req, nullif(p->>'actor', '')::uuid)
  RETURNING id INTO v_id;
  v_res := jsonb_build_object('ok', true, 'action', 'create', 'credit_id', v_id, 'amount', v_amt);
  INSERT INTO public.hub_vendor_credit_requests (request_id, action, fingerprint, result, created_by) VALUES (v_req, 'create', v_fp, v_res, nullif(p->>'actor', '')::uuid);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'vendor_credit_create', 'vendor_credit', v_id::text,
    jsonb_build_object('vendor', p->>'vendor_name', 'number', p->>'credit_number', 'date', p->>'credit_date', 'currency', upper(coalesce(p->>'currency', 'USD')), 'amount', v_amt, 'reason', p->>'reason'));
  RETURN v_res;
END $$;

-- 6. apply a credit to ONE bill (the Hub server only). Locks: bill first (the same key as every payment / wire guard), then the credit.
CREATE OR REPLACE FUNCTION public.hub_vendor_credit_apply(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_req text := nullif(p->>'request_id', ''); v_credit uuid := (p->>'credit_id')::uuid; v_bill uuid := (p->>'bill_id')::uuid;
  v_amt numeric := round((p->>'amount')::numeric, 2); v_date date := coalesce(nullif(p->>'applied_date', '')::date, (now() AT TIME ZONE 'America/New_York')::date);
  v_fp text; v_old record; c record; b record; v_paid numeric; v_wire numeric; v_cred numeric; v_owed numeric; v_left numeric; v_lock date; v_id uuid; v_res jsonb;
BEGIN
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a request id is required.'; END IF;
  v_fp := md5(concat_ws('|', 'apply', v_credit::text, v_bill::text, v_amt::text, v_date::text));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-credit-req:' || v_req, 0));
  SELECT * INTO v_old FROM public.hub_vendor_credit_requests WHERE request_id = v_req;
  IF FOUND THEN
    IF v_old.fingerprint = v_fp THEN RETURN v_old.result || jsonb_build_object('repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: that request id was already used for a different action.';
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: the amount to apply must be above zero.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || v_bill::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-credit:' || v_credit::text, 0));
  SELECT * INTO c FROM public.vendor_credits WHERE id = v_credit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the credit memo was not found.'; END IF;
  IF c.record_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this credit memo is voided.'; END IF;
  SELECT id, wave_business_id, vendor_name, bill_number, currency, total_amount, record_status, disputed INTO b FROM public.vendor_bills WHERE id = v_bill FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill was not found.'; END IF;
  IF b.record_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this bill is % — a credit cannot be applied to it.', coalesce(b.record_status, 'not active'); END IF;
  IF b.disputed IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: this bill is disputed — settle the dispute first.'; END IF;
  IF b.wave_business_id IS DISTINCT FROM c.wave_business_id THEN RAISE EXCEPTION 'HUB_GUARD: the bill and the credit memo belong to different companies.'; END IF;
  IF public.hub_vendor_key(b.vendor_name) IS DISTINCT FROM public.hub_vendor_key(c.vendor_name) THEN
    RAISE EXCEPTION 'HUB_GUARD: the credit memo is from %, the bill is from % — a credit is only applied to the same vendor''s bills.', c.vendor_name, b.vendor_name; END IF;
  IF upper(coalesce(b.currency, 'USD')) <> c.currency THEN RAISE EXCEPTION 'HUB_GUARD: the bill is in %, the credit memo in % — no conversion is made.', upper(coalesce(b.currency, 'USD')), c.currency; END IF;
  IF v_date < c.credit_date THEN RAISE EXCEPTION 'HUB_GUARD: a credit cannot be applied before its own date (%).', c.credit_date; END IF;
  IF to_regclass('clickbooks_us.books') IS NOT NULL THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO v_lock;
    IF v_lock IS NOT NULL AND v_date <= v_lock THEN RAISE EXCEPTION 'HUB_GUARD: % is inside a closed month (books are closed through %).', v_date, v_lock; END IF;
  END IF;
  v_left := round(c.total_amount, 2) - public.hub_credit_used(v_credit);
  IF v_amt > v_left + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: only $% of this credit memo is left — $% was asked.', to_char(greatest(v_left, 0), 'FM999,999,990.00'), to_char(v_amt, 'FM999,999,990.00'); END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = v_bill AND voided IS NOT TRUE;
  v_wire := 0; IF to_regclass('public.wire_package_lines') IS NOT NULL THEN SELECT coalesce(sum(round(amount, 2)), 0) INTO v_wire FROM public.wire_package_lines WHERE bill_id = v_bill AND is_open IS TRUE; END IF;
  v_cred := public.hub_bill_credits(v_bill);
  v_owed := round(coalesce(b.total_amount, 0), 2) - v_paid - v_wire - v_cred;
  IF v_amt > v_owed + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: this bill only has $% left to credit (total $%, paid $%, on open wires $%, credits already applied $%) — $% was asked.',
      to_char(greatest(v_owed, 0), 'FM999,999,990.00'), to_char(round(b.total_amount, 2), 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00'), to_char(v_wire, 'FM999,999,990.00'), to_char(v_cred, 'FM999,999,990.00'), to_char(v_amt, 'FM999,999,990.00');
  END IF;
  INSERT INTO public.vendor_credit_applications (credit_id, bill_id, amount, applied_date, reason, request_id, applied_by)
  VALUES (v_credit, v_bill, v_amt, v_date, nullif(p->>'reason', ''), v_req, nullif(p->>'actor', '')::uuid) RETURNING id INTO v_id;
  v_res := jsonb_build_object('ok', true, 'action', 'apply', 'application_id', v_id, 'amount', v_amt, 'bill_left', round(v_owed - v_amt, 2), 'credit_left', round(v_left - v_amt, 2));
  INSERT INTO public.hub_vendor_credit_requests (request_id, action, fingerprint, result, created_by) VALUES (v_req, 'apply', v_fp, v_res, nullif(p->>'actor', '')::uuid);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'vendor_credit_apply', 'vendor_bill', v_bill::text,
    jsonb_build_object('credit_id', v_credit, 'credit_number', c.credit_number, 'vendor', c.vendor_name, 'bill_number', b.bill_number, 'amount', v_amt, 'applied_date', v_date, 'bill_left', round(v_owed - v_amt, 2)));
  RETURN v_res;
END $$;

-- 7. undo ONE application (raises what the bill owes again; never makes anything over-paid). Kept, voided, audited.
CREATE OR REPLACE FUNCTION public.hub_vendor_credit_unapply(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_lock date;
BEGIN
  IF length(btrim(coalesce(p->>'reason', ''))) < 3 THEN RAISE EXCEPTION 'HUB_GUARD: say why, in a few words.'; END IF;
  SELECT * INTO a FROM public.vendor_credit_applications WHERE id = (p->>'application_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: that credit application was not found.'; END IF;
  IF a.bill_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || a.bill_id::text, 0)); END IF;
  IF a.bank_transaction_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || a.bank_transaction_id::text, 0)); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-credit:' || a.credit_id::text, 0));
  SELECT * INTO a FROM public.vendor_credit_applications WHERE id = a.id FOR UPDATE;
  IF a.voided IS TRUE THEN RETURN jsonb_build_object('ok', true, 'action', 'unapply', 'application_id', a.id, 'repeat', true); END IF;
  IF to_regclass('clickbooks_us.books') IS NOT NULL THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO v_lock;
    IF v_lock IS NOT NULL AND a.applied_date <= v_lock THEN RAISE EXCEPTION 'HUB_GUARD: this credit was applied on %, inside a closed month (closed through %). Reopen the month first.', a.applied_date, v_lock; END IF;
  END IF;
  UPDATE public.vendor_credit_applications SET voided = true, void_reason = btrim(p->>'reason'), voided_by = nullif(p->>'actor', '')::uuid, voided_at = now() WHERE id = a.id;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'vendor_credit_unapply', CASE WHEN a.kind = 'refund' THEN 'bank_transaction' ELSE 'vendor_bill' END, coalesce(a.bill_id, a.bank_transaction_id)::text,
    jsonb_build_object('application_id', a.id, 'credit_id', a.credit_id, 'amount', a.amount, 'reason', btrim(p->>'reason')));
  RETURN jsonb_build_object('ok', true, 'action', 'unapply', 'application_id', a.id, 'amount', a.amount);
END $$;

-- 7b. the vendor REFUNDS (part of) the credit as money: name the money-in bank line it arrived on. The WHOLE line is used for this one
--     credit (no stranded remainder); it must fit in what the credit has left; the line may not already be an invoice payment, a
--     transfer between own accounts, an RTM / NextTrade money back, or another credit's refund — and afterwards it cannot become one.
CREATE OR REPLACE FUNCTION public.hub_vendor_credit_refund(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_req text := nullif(p->>'request_id', ''); v_credit uuid := (p->>'credit_id')::uuid; v_line uuid := (p->>'bank_transaction_id')::uuid;
  v_fp text; v_old record; c record; t record; v_amt numeric; v_left numeric; v_d date; v_lock date; v_id uuid; v_res jsonb;
BEGIN
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a request id is required.'; END IF;
  v_fp := md5(concat_ws('|', 'refund', v_credit::text, v_line::text));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-credit-req:' || v_req, 0));
  SELECT * INTO v_old FROM public.hub_vendor_credit_requests WHERE request_id = v_req;
  IF FOUND THEN
    IF v_old.fingerprint = v_fp THEN RETURN v_old.result || jsonb_build_object('repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: that request id was already used for a different action.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_line::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-credit:' || v_credit::text, 0));
  SELECT * INTO c FROM public.vendor_credits WHERE id = v_credit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the credit memo was not found.'; END IF;
  IF c.record_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this credit memo is voided.'; END IF;
  SELECT id, wave_business_id, direction, pending, review_status, amount_abs, coalesce(posted_date, date) AS d, matched_invoice_id, transfer_group_id, upper(coalesce(iso_currency, 'USD')) AS cur
    INTO t FROM public.bank_transactions WHERE id = v_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the money-in bank line was not found.'; END IF;
  IF t.wave_business_id IS DISTINCT FROM c.wave_business_id THEN RAISE EXCEPTION 'HUB_GUARD: that bank line belongs to another company.'; END IF;
  IF t.direction IS DISTINCT FROM 'in' OR t.pending IS TRUE OR t.review_status = 'duplicate' THEN RAISE EXCEPTION 'HUB_GUARD: a refund is a settled money-in bank line (not pending, not a duplicate copy).'; END IF;
  IF t.cur <> c.currency THEN RAISE EXCEPTION 'HUB_GUARD: the bank line is in %, the credit memo in % — no conversion is made.', t.cur, c.currency; END IF;
  IF t.matched_invoice_id IS NOT NULL OR t.transfer_group_id IS NOT NULL THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is already matched to an invoice or paired as a transfer.'; END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_invoice_payments ip WHERE ip.bank_transaction_id = v_line AND ip.voided IS NOT TRUE) THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is a customer payment.'; END IF;
  IF to_regclass('public.party_money_entries') IS NOT NULL AND EXISTS (SELECT 1 FROM public.party_money_entries e WHERE e.kind = 'refund' AND e.bank_transaction_id = v_line) THEN
    RAISE EXCEPTION 'HUB_GUARD: that bank line is already money back from RTM / NextTrade.'; END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_credit_applications a WHERE a.kind = 'refund' AND a.bank_transaction_id = v_line AND a.voided IS NOT TRUE) THEN
    RAISE EXCEPTION 'HUB_GUARD: that bank line is already recorded as a vendor credit refund.'; END IF;
  v_d := t.d;
  IF v_d < c.credit_date THEN RAISE EXCEPTION 'HUB_GUARD: the money arrived (%) before the credit memo''s date (%).', v_d, c.credit_date; END IF;
  IF to_regclass('clickbooks_us.books') IS NOT NULL THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO v_lock;
    IF v_lock IS NOT NULL AND v_d <= v_lock THEN RAISE EXCEPTION 'HUB_GUARD: % is inside a closed month (books are closed through %).', v_d, v_lock; END IF;
  END IF;
  v_amt := round(abs(coalesce(t.amount_abs, 0)), 2);
  v_left := round(c.total_amount, 2) - public.hub_credit_used(v_credit);
  IF v_amt <= 0 OR v_amt > v_left + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: the bank line is $% but only $% of this credit memo is left — a refund uses the whole line and cannot be more than what is left.', to_char(v_amt, 'FM999,999,990.00'), to_char(greatest(v_left, 0), 'FM999,999,990.00'); END IF;
  INSERT INTO public.vendor_credit_applications (credit_id, kind, bank_transaction_id, amount, applied_date, reason, request_id, applied_by)
  VALUES (v_credit, 'refund', v_line, v_amt, v_d, nullif(p->>'reason', ''), v_req, nullif(p->>'actor', '')::uuid) RETURNING id INTO v_id;
  v_res := jsonb_build_object('ok', true, 'action', 'refund', 'application_id', v_id, 'amount', v_amt, 'credit_left', round(v_left - v_amt, 2));
  INSERT INTO public.hub_vendor_credit_requests (request_id, action, fingerprint, result, created_by) VALUES (v_req, 'refund', v_fp, v_res, nullif(p->>'actor', '')::uuid);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'vendor_credit_refund', 'bank_transaction', v_line::text,
    jsonb_build_object('credit_id', v_credit, 'credit_number', c.credit_number, 'vendor', c.vendor_name, 'amount', v_amt, 'date', v_d));
  RETURN v_res;
END $$;

-- 7c. a bank line that is a vendor credit refund cannot afterwards become an invoice match, a customer payment, a transfer pair or an
--     RTM / NextTrade money back (undo the refund first). Same bank-line lock as the refund itself.
CREATE OR REPLACE FUNCTION public.hub_vendor_refund_line_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_line uuid;
BEGIN
  IF TG_TABLE_NAME = 'bank_transactions' THEN
    IF NEW.matched_invoice_id IS NULL AND NEW.transfer_group_id IS NULL THEN RETURN NEW; END IF; v_line := NEW.id;
  ELSIF TG_TABLE_NAME = 'party_money_entries' THEN
    IF NEW.kind IS DISTINCT FROM 'refund' THEN RETURN NEW; END IF; v_line := NEW.bank_transaction_id;
  ELSE
    IF NEW.voided IS TRUE THEN RETURN NEW; END IF; v_line := NEW.bank_transaction_id;
  END IF;
  IF v_line IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_line::text, 0));
  IF EXISTS (SELECT 1 FROM public.vendor_credit_applications a WHERE a.kind = 'refund' AND a.bank_transaction_id = v_line AND a.voided IS NOT TRUE) THEN
    RAISE EXCEPTION 'HUB_GUARD: this bank line is a vendor credit refund — undo that refund first.'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_vendor_refund_line_only() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS hub_vendor_refund_line_only ON public.bank_transactions;
CREATE TRIGGER hub_vendor_refund_line_only BEFORE UPDATE OF matched_invoice_id, transfer_group_id ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.hub_vendor_refund_line_only();
DO $r$ BEGIN
  IF to_regclass('public.accounting_invoice_payments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS hub_vendor_refund_line_only ON public.accounting_invoice_payments;
    CREATE TRIGGER hub_vendor_refund_line_only BEFORE INSERT OR UPDATE OF bank_transaction_id, voided ON public.accounting_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.hub_vendor_refund_line_only();
  END IF;
  IF to_regclass('public.party_money_entries') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS hub_vendor_refund_line_only ON public.party_money_entries;
    CREATE TRIGGER hub_vendor_refund_line_only BEFORE INSERT ON public.party_money_entries FOR EACH ROW EXECUTE FUNCTION public.hub_vendor_refund_line_only();
  END IF;
END $r$;

-- 8. void a credit memo entered by mistake (only when nothing of it is applied)
CREATE OR REPLACE FUNCTION public.hub_vendor_credit_void(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  IF length(btrim(coalesce(p->>'reason', ''))) < 3 THEN RAISE EXCEPTION 'HUB_GUARD: say why, in a few words.'; END IF;
  SELECT * INTO c FROM public.vendor_credits WHERE id = (p->>'credit_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the credit memo was not found.'; END IF;
  IF c.record_status = 'void' THEN RETURN jsonb_build_object('ok', true, 'action', 'void', 'credit_id', c.id, 'repeat', true); END IF;
  UPDATE public.vendor_credits SET record_status = 'void', void_reason = btrim(p->>'reason'), voided_by = nullif(p->>'actor', '')::uuid, voided_at = now() WHERE id = c.id; -- the lock trigger refuses while applied
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'vendor_credit_void', 'vendor_credit', c.id::text,
    jsonb_build_object('number', c.credit_number, 'vendor', c.vendor_name, 'amount', c.total_amount, 'reason', btrim(p->>'reason')));
  RETURN jsonb_build_object('ok', true, 'action', 'void', 'credit_id', c.id);
END $$;

REVOKE ALL ON FUNCTION public.hub_vendor_credit_create(jsonb), public.hub_vendor_credit_apply(jsonb), public.hub_vendor_credit_unapply(jsonb), public.hub_vendor_credit_void(jsonb), public.hub_vendor_credit_refund(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_vendor_credit_create(jsonb), public.hub_vendor_credit_apply(jsonb), public.hub_vendor_credit_unapply(jsonb), public.hub_vendor_credit_void(jsonb), public.hub_vendor_credit_refund(jsonb) TO service_role;

-- 9. the EXISTING caps now count applied credits (bodies as installed — US / TO — plus the credit term; same locks, same messages + credits)
CREATE OR REPLACE FUNCTION public.hub_wire_line_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_status text; v_paid numeric; v_open numeric; v_left numeric; v_cred numeric;
BEGIN
  IF NEW.is_open IS NOT TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_open IS TRUE AND NEW.amount <= OLD.amount AND NEW.bill_id = OLD.bill_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2), record_status INTO v_total, v_status FROM public.vendor_bills WHERE id = NEW.bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill on this wire line was not found.'; END IF;
  IF v_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this bill is % — it cannot go on a wire.', coalesce(v_status, 'not active'); END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_open FROM public.wire_package_lines WHERE bill_id = NEW.bill_id AND is_open IS TRUE AND id IS DISTINCT FROM NEW.id;
  v_cred := public.hub_bill_credits(NEW.bill_id);
  v_left := v_total - v_paid - v_open - v_cred;
  IF round(NEW.amount, 2) > v_left + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: only $% is left on this bill (total $%, paid $%, on other open wires $%, vendor credits applied $%) — this wire line asks $%.',
      to_char(greatest(v_left, 0), 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00'), to_char(v_open, 'FM999,999,990.00'), to_char(v_cred, 'FM999,999,990.00'), to_char(round(NEW.amount, 2), 'FM999,999,990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_wire_line_cap() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hub_bill_payment_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_status text; v_paid numeric; v_cred numeric;
BEGIN
  IF NEW.voided IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.voided IS NOT TRUE AND round(NEW.amount, 2) <= round(OLD.amount, 2) AND NEW.bill_id = OLD.bill_id THEN RETURN NEW; END IF;
  IF NEW.bank_transaction_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || NEW.bank_transaction_id::text, 0)); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2), record_status INTO v_total, v_status FROM public.vendor_bills WHERE id = NEW.bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill for this payment was not found.'; END IF;
  IF v_status IS NOT NULL AND v_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this bill is % — it cannot take a payment.', v_status; END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE AND id IS DISTINCT FROM NEW.id;
  v_cred := public.hub_bill_credits(NEW.bill_id);
  IF v_paid + v_cred + round(NEW.amount, 2) > v_total + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: this payment of $% would pay the bill more than it owes (total $%, already paid $%, vendor credits applied $%).',
      to_char(round(NEW.amount, 2), 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00'), to_char(v_cred, 'FM999,999,990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_payment_cap() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hub_bill_payment_final() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_paid numeric; v_open numeric := 0; v_live boolean; v_cred numeric;
BEGIN
  SELECT (voided IS NOT TRUE) INTO v_live FROM public.vendor_bill_payments WHERE id = NEW.id;
  IF v_live IS NOT TRUE THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2) INTO v_total FROM public.vendor_bills WHERE id = NEW.bill_id;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE;
  IF to_regclass('public.wire_package_lines') IS NOT NULL THEN
    SELECT coalesce(sum(round(amount, 2)), 0) INTO v_open FROM public.wire_package_lines WHERE bill_id = NEW.bill_id AND is_open IS TRUE;
  END IF;
  v_cred := public.hub_bill_credits(NEW.bill_id);
  IF v_paid + v_open + v_cred > v_total + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: this bill would be at $% paid + $% held on open wires + $% vendor credits — more than its total of $%. Lower the payment, change / cancel that wire, or undo a credit first.',
      to_char(v_paid, 'FM999,999,990.00'), to_char(v_open, 'FM999,999,990.00'), to_char(v_cred, 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_payment_final() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hub_guard_bill_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_bank_amt numeric; v_bank_used numeric; v_bill_total numeric; v_bill_paid numeric; v_cred numeric;
BEGIN
  IF NEW.voided IS TRUE THEN RETURN NULL; END IF;
  IF NEW.bank_transaction_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || NEW.bank_transaction_id::text, 0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  IF NEW.bank_transaction_id IS NOT NULL THEN
    SELECT amount_abs INTO v_bank_amt FROM public.bank_transactions WHERE id = NEW.bank_transaction_id;
    IF v_bank_amt IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank transaction was not found.'; END IF;
    SELECT coalesce(sum(amount), 0) INTO v_bank_used FROM public.vendor_bill_payments
      WHERE bank_transaction_id = NEW.bank_transaction_id AND voided IS NOT TRUE;
    IF v_bank_used > v_bank_amt + 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: that bank line is %; bills paid from it would come to % — over by %.', round(v_bank_amt, 2), round(v_bank_used, 2), round(v_bank_used - v_bank_amt, 2);
    END IF;
  END IF;
  SELECT total_amount INTO v_bill_total FROM public.vendor_bills WHERE id = NEW.bill_id;
  SELECT coalesce(sum(amount), 0) INTO v_bill_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE;
  v_cred := public.hub_bill_credits(NEW.bill_id);
  IF v_bill_paid + v_cred > coalesce(v_bill_total, 0) + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: the bill total is %; payments on it (%) plus vendor credits applied (%) would be more — over by %.', round(coalesce(v_bill_total, 0), 2), round(v_bill_paid, 2), round(v_cred, 2), round(v_bill_paid + v_cred - coalesce(v_bill_total, 0), 2);
  END IF;
  RETURN NULL;
END $$;

-- 10. a bill with a credit applied cannot be voided / deleted (undo the credit first) — same bill lock as the payment guards
CREATE OR REPLACE FUNCTION public.hub_bill_void_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int; v_sum numeric;
BEGIN
  IF NOT ((OLD.record_status IS NULL OR OLD.record_status = 'active') AND NEW.record_status IS NOT NULL AND NEW.record_status <> 'active') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.id::text, 0));
  SELECT count(*), coalesce(sum(round(amount, 2)), 0) INTO v_n, v_sum FROM public.vendor_bill_payments WHERE bill_id = NEW.id AND voided IS NOT TRUE;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'HUB_GUARD: this bill has % payment(s) totalling $% that are not undone — undo them first, then it can be made %.', v_n, to_char(v_sum, 'FM999,999,990.00'), NEW.record_status;
  END IF;
  IF to_regclass('public.wire_package_lines') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.wire_package_lines WHERE bill_id = NEW.id AND is_open IS TRUE;
    IF v_n > 0 THEN RAISE EXCEPTION 'HUB_GUARD: this bill is on an open wire — untick it there (or cancel the wire) first.'; END IF;
  END IF;
  SELECT count(*), coalesce(sum(round(amount, 2)), 0) INTO v_n, v_sum FROM public.vendor_credit_applications WHERE bill_id = NEW.id AND voided IS NOT TRUE;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'HUB_GUARD: vendor credits of $% are applied to this bill — undo them first, then it can be made %.', to_char(v_sum, 'FM999,999,990.00'), NEW.record_status;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_void_guard() FROM public, anon, authenticated;

-- 11. a bill's TOTAL cannot be lowered below what is paid + held on wires + credited
CREATE OR REPLACE FUNCTION public.hub_bill_total_floor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_paid numeric; v_open numeric := 0; v_cred numeric;
BEGIN
  IF round(coalesce(NEW.total_amount, 0), 2) >= round(coalesce(OLD.total_amount, 0), 2) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.id::text, 0));
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.id AND voided IS NOT TRUE;
  IF to_regclass('public.wire_package_lines') IS NOT NULL THEN SELECT coalesce(sum(round(amount, 2)), 0) INTO v_open FROM public.wire_package_lines WHERE bill_id = NEW.id AND is_open IS TRUE; END IF;
  v_cred := public.hub_bill_credits(NEW.id);
  IF v_cred > 0 AND v_paid + v_open + v_cred > round(coalesce(NEW.total_amount, 0), 2) + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: the bill total cannot go below $% (paid $%, on open wires $%, vendor credits applied $%).', to_char(v_paid + v_open + v_cred, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00'), to_char(v_open, 'FM999,999,990.00'), to_char(v_cred, 'FM999,999,990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_total_floor() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS hub_bill_total_floor ON public.vendor_bills;
CREATE TRIGGER hub_bill_total_floor BEFORE UPDATE OF total_amount ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.hub_bill_total_floor();

-- the existing triggers keep pointing at these functions (re-created only if missing)
DO $t$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_wire_line_cap') THEN CREATE TRIGGER hub_wire_line_cap BEFORE INSERT OR UPDATE ON public.wire_package_lines FOR EACH ROW EXECUTE FUNCTION public.hub_wire_line_cap(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_payment_cap') THEN CREATE TRIGGER hub_bill_payment_cap BEFORE INSERT OR UPDATE ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.hub_bill_payment_cap(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_payment_final') THEN CREATE CONSTRAINT TRIGGER hub_bill_payment_final AFTER INSERT OR UPDATE ON public.vendor_bill_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_bill_payment_final(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_guard_bill_payment') THEN CREATE TRIGGER hub_guard_bill_payment AFTER INSERT OR UPDATE OF amount, voided, bill_id, bank_transaction_id ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.hub_guard_bill_payment(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_void_guard') THEN CREATE TRIGGER hub_bill_void_guard BEFORE UPDATE OF record_status ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.hub_bill_void_guard(); END IF;
END $t$;

-- 12. the Hub asks this before showing the credit screens
CREATE OR REPLACE FUNCTION public.hub_vendor_credits_installed() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regclass('public.vendor_credit_applications') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_vendor_credit_apply')
     AND position('hub_bill_credits' in pg_get_functiondef('public.hub_bill_payment_final()'::regprocedure)) > 0 $$;
GRANT EXECUTE ON FUNCTION public.hub_vendor_credits_installed() TO service_role, authenticated;

-- 13. check (read-only): every line should say OK
SELECT 'credit tables, RLS on, no browser access' AS what, CASE WHEN (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN ('public.vendor_credits'::regclass, 'public.vendor_credit_applications'::regclass)) AND NOT has_table_privilege('authenticated', 'public.vendor_credits', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'every cap counts applied credits', CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('hub_wire_line_cap', 'hub_bill_payment_cap', 'hub_bill_payment_final', 'hub_guard_bill_payment', 'hub_bill_void_guard', 'hub_bill_total_floor') AND (position('hub_bill_credits' in pg_get_functiondef(p.oid)) > 0 OR position('vendor_credit_applications' in pg_get_functiondef(p.oid)) > 0)) = 6 THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'only the Hub server can record / apply / undo', CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_vendor_credit_apply(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hub_vendor_credit_create(jsonb)', 'EXECUTE') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'installed flag', CASE WHEN public.hub_vendor_credits_installed() THEN 'OK' ELSE 'PROBLEM' END;
