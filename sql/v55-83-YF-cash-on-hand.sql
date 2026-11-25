-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v55.83-YF — CASH ON HAND (Max, 23 Nov 2026: "make sure we have a cash on hand to pay invoices"; the coordinator's reading 1: money that
-- actually moves in cash). Cash on Hand is ONE hand-made account of KTC USA. Every cash movement is a line on that account, written ONLY
-- by the functions below, so every existing path treats it like a bank line: invoice balance, bill payment caps (TH: the bill payment HAS
-- its line — the cash line), ClickBooks ledger (bank_ledger_map → the existing "Cash on Hand" account), transfers, history window, and
-- privacy (the account is PRIVATE: its lines and balance follow the private-account rule — super admin or an explicit grant).
--   receive_invoice  a customer pays an invoice in cash          → money IN on Cash on Hand + the invoice payment (source 'cash')
--   pay_bill         a bill is paid in cash                       → money OUT on Cash on Hand + the bill payment (method 'cash')
--   deposit          the cash is taken to the bank               → money OUT on Cash on Hand, paired with the bank's money-in line (a
--                                                                    transfer between own accounts: the deposit is never income again)
--   adjust           a cash count / opening float (in or out)     → a line with a required reason (super admin only, in the Hub)
-- The balance (by date) can never go below zero. Undo voids the payment and takes the line out (review_status 'duplicate', like every
-- duplicate copy the Hub already ignores) — nothing is deleted. Every step: one transaction, locked, closed-month check, audited.
-- Re-runnable. Only the Hub server (service_role) can write.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 0. the account (KTC USA). Private. One connection row of its own (status 'manual', like the other hand-made accounts).
DO $acct$
DECLARE v_us text := 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk'; v_conn uuid; v_book uuid; v_gl uuid; v_n int;
BEGIN
  SELECT id INTO v_conn FROM public.bank_connections WHERE plaid_item_id = 'manual-cash-on-hand-us';
  IF v_conn IS NULL THEN
    INSERT INTO public.bank_connections (status, plaid_item_id, access_token, institution_name, wave_business_id, is_read_only, last_synced)
    VALUES ('manual', 'manual-cash-on-hand-us', 'manual-no-plaid', 'Cash on Hand', v_us, true, now()) RETURNING id INTO v_conn;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plaid_accounts WHERE plaid_account_id = 'manual-acct-cash-on-hand-us') THEN
    INSERT INTO public.plaid_accounts (connection_id, plaid_account_id, name, official_name, mask, type, subtype, iso_currency, is_read_only, wave_business_id, is_private, assignment_source, updated_at)
    VALUES (v_conn, 'manual-acct-cash-on-hand-us', 'Cash on Hand', 'Cash on Hand', 'CASH', 'cash', 'cash', 'USD', true, v_us, true, 'v55.83-YF', now());
  END IF;
  -- the ledger: map to the existing "Cash on Hand" account of the KTC_US book, only when that resolves to exactly one account
  IF to_regclass('clickbooks_us.bank_ledger_map') IS NOT NULL THEN
    SELECT id INTO v_book FROM clickbooks_us.books WHERE code = 'KTC_US';
    SELECT count(*) INTO v_n FROM clickbooks_us.accounts WHERE book_id = v_book AND lower(btrim(name)) = 'cash on hand';
    IF v_book IS NOT NULL AND v_n = 1 AND NOT EXISTS (SELECT 1 FROM clickbooks_us.bank_ledger_map WHERE book_id = v_book AND provider_account_id = 'manual-acct-cash-on-hand-us') THEN
      SELECT id INTO v_gl FROM clickbooks_us.accounts WHERE book_id = v_book AND lower(btrim(name)) = 'cash on hand';
      INSERT INTO clickbooks_us.bank_ledger_map (book_id, provider_account_id, account_id, reviewed, evidence)
      VALUES (v_book, 'manual-acct-cash-on-hand-us', v_gl, true, 'v55.83-YF Cash on Hand (Hub cash account) → ledger account "Cash on Hand", Max 23 Nov 2026');
    END IF;
  END IF;
END $acct$;

CREATE OR REPLACE FUNCTION public.hub_cash_account() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 'manual-acct-cash-on-hand-us'::text $$;

-- 1. the cash book: one row per movement, linked to its line and to what it paid
CREATE TABLE IF NOT EXISTS public.cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('receive_invoice', 'pay_bill', 'deposit', 'adjust_in', 'adjust_out')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  entry_date date NOT NULL,
  bank_transaction_id uuid NOT NULL UNIQUE,            -- the line on the Cash on Hand account
  invoice_id uuid, invoice_payment_id uuid, payment_match_id uuid,
  bill_id uuid, bill_payment_id uuid,
  deposit_bank_transaction_id uuid,                    -- the bank's money-in line the cash went into (when paired)
  person text NOT NULL CHECK (length(btrim(person)) >= 2),           -- who received / paid / deposited the cash
  reference text NOT NULL CHECK (length(btrim(reference)) >= 2),     -- receipt number / note the cash is backed by
  note text,
  request_id text UNIQUE,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  voided boolean NOT NULL DEFAULT false, void_reason text, voided_by uuid, voided_at timestamptz,
  CHECK (voided IS NOT TRUE OR (void_reason IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_deposit_line ON public.cash_entries (deposit_bank_transaction_id) WHERE deposit_bank_transaction_id IS NOT NULL AND voided IS NOT TRUE;
CREATE TABLE IF NOT EXISTS public.hub_cash_requests (request_id text PRIMARY KEY, action text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_cash_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_entries, public.hub_cash_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cash_entries TO service_role;
CREATE OR REPLACE FUNCTION public.hub_cash_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'HUB_GUARD: cash entries are never deleted — undo them instead.'; END $$;
DROP TRIGGER IF EXISTS hub_cash_no_delete ON public.cash_entries;
CREATE TRIGGER hub_cash_no_delete BEFORE DELETE ON public.cash_entries FOR EACH ROW EXECUTE FUNCTION public.hub_cash_no_delete();

-- 2. the lines of the Cash on Hand account are written ONLY by these functions (flag hub.cash_write for this transaction): no hand entry,
--    no match / pair / status change from another screen, never deleted. Syncing columns (Wave / ledger stamps) stay free.
CREATE OR REPLACE FUNCTION public.hub_cash_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_flag text := coalesce(current_setting('hub.cash_write', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.account_id = public.hub_cash_account() THEN RAISE EXCEPTION 'HUB_GUARD: Cash on Hand lines are never deleted — undo the cash entry instead.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.account_id = public.hub_cash_account() AND v_flag <> 'on' THEN RAISE EXCEPTION 'HUB_GUARD: Cash on Hand lines are only made in Accounting → Cash on Hand.'; END IF;
    RETURN NEW;
  END IF;
  IF (OLD.account_id = public.hub_cash_account() OR NEW.account_id = public.hub_cash_account()) AND v_flag <> 'on' AND (
       NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.amount_abs IS DISTINCT FROM OLD.amount_abs
    OR NEW.direction IS DISTINCT FROM OLD.direction OR NEW.date IS DISTINCT FROM OLD.date OR NEW.posted_date IS DISTINCT FROM OLD.posted_date
    OR NEW.pending IS DISTINCT FROM OLD.pending OR NEW.wave_business_id IS DISTINCT FROM OLD.wave_business_id OR NEW.review_status IS DISTINCT FROM OLD.review_status
    OR NEW.matched_invoice_id IS DISTINCT FROM OLD.matched_invoice_id OR NEW.transfer_group_id IS DISTINCT FROM OLD.transfer_group_id OR NEW.linked_id IS DISTINCT FROM OLD.linked_id
    OR NEW.third_party_payer IS DISTINCT FROM OLD.third_party_payer) THEN
    RAISE EXCEPTION 'HUB_GUARD: Cash on Hand lines change only through Accounting → Cash on Hand (undo the entry and record it again).';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_cash_line_guard() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS hub_cash_line_guard ON public.bank_transactions;
CREATE TRIGGER hub_cash_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.hub_cash_line_guard();
-- payments, matches and splits cannot be hung on a cash line from another screen either
CREATE OR REPLACE FUNCTION public.hub_cash_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(current_setting('hub.cash_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.bank_transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bank_transactions t WHERE t.id = NEW.bank_transaction_id AND t.account_id = public.hub_cash_account())
     AND (TG_OP = 'INSERT' OR NEW.bank_transaction_id IS DISTINCT FROM OLD.bank_transaction_id) THEN
    RAISE EXCEPTION 'HUB_GUARD: a Cash on Hand line is matched only through Accounting → Cash on Hand.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_cash_link_guard() FROM public, anon, authenticated;
DO $l$ BEGIN
  DROP TRIGGER IF EXISTS hub_cash_link_guard ON public.accounting_invoice_payments;
  CREATE TRIGGER hub_cash_link_guard BEFORE INSERT OR UPDATE OF bank_transaction_id ON public.accounting_invoice_payments FOR EACH ROW EXECUTE FUNCTION public.hub_cash_link_guard();
  DROP TRIGGER IF EXISTS hub_cash_link_guard ON public.vendor_bill_payments;
  CREATE TRIGGER hub_cash_link_guard BEFORE INSERT OR UPDATE OF bank_transaction_id ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.hub_cash_link_guard();
  DROP TRIGGER IF EXISTS hub_cash_link_guard ON public.payment_matches;
  CREATE TRIGGER hub_cash_link_guard BEFORE INSERT OR UPDATE OF bank_transaction_id ON public.payment_matches FOR EACH ROW EXECUTE FUNCTION public.hub_cash_link_guard();
  IF to_regclass('public.bank_transaction_splits') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS hub_cash_link_guard ON public.bank_transaction_splits;
    CREATE TRIGGER hub_cash_link_guard BEFORE INSERT OR UPDATE OF bank_transaction_id ON public.bank_transaction_splits FOR EACH ROW EXECUTE FUNCTION public.hub_cash_link_guard();
  END IF;
END $l$;

-- 3. the balance: what is in the cash box at the END of a day (live lines only); and the lowest it ever gets from a date on
CREATE OR REPLACE FUNCTION public.hub_cash_balance(p_on date) RETURNS numeric LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(sum(CASE WHEN t.direction = 'in' THEN round(t.amount_abs, 2) ELSE -round(t.amount_abs, 2) END), 0)
  FROM public.bank_transactions t WHERE t.account_id = public.hub_cash_account() AND coalesce(t.review_status, '') <> 'duplicate' AND t.pending IS NOT TRUE
    AND coalesce(t.posted_date, t.date) <= coalesce(p_on, '9999-12-31'::date) $$;
CREATE OR REPLACE FUNCTION public.hub_cash_lowest_from(p_from date) RETURNS numeric LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT min(public.hub_cash_balance(d)) FROM (
    SELECT p_from AS d UNION SELECT DISTINCT coalesce(t.posted_date, t.date) FROM public.bank_transactions t
    WHERE t.account_id = public.hub_cash_account() AND coalesce(t.posted_date, t.date) >= p_from) x $$;
REVOKE ALL ON FUNCTION public.hub_cash_balance(date), public.hub_cash_lowest_from(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_cash_balance(date), public.hub_cash_lowest_from(date) TO service_role;

-- 4. shared steps
CREATE OR REPLACE FUNCTION public.hub_cash_begin(p jsonb, p_action text, p_fp text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_req text := nullif(p->>'request_id', ''); v_old record; v_lock date; v_d date := nullif(p->>'entry_date', '')::date;
BEGIN
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a request id is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-cash-req:' || v_req, 0));
  SELECT * INTO v_old FROM public.hub_cash_requests WHERE request_id = v_req;
  IF FOUND THEN
    IF v_old.fingerprint = p_fp THEN RETURN v_old.result || jsonb_build_object('repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: that request id was already used for a different action.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-cash-box', 0));  -- one cash movement at a time (the balance is one box)
  IF v_d IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the date the cash moved.'; END IF;
  IF v_d > (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'HUB_GUARD: the date cannot be in the future.'; END IF;
  IF length(btrim(coalesce(p->>'person', ''))) < 2 THEN RAISE EXCEPTION 'HUB_GUARD: say who handed over / received the cash.'; END IF;
  IF length(btrim(coalesce(p->>'reference', ''))) < 2 THEN RAISE EXCEPTION 'HUB_GUARD: a receipt number or note is required for cash.'; END IF;
  IF to_regclass('clickbooks_us.books') IS NOT NULL THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO v_lock;
    IF v_lock IS NOT NULL AND v_d <= v_lock THEN RAISE EXCEPTION 'HUB_GUARD: % is inside a closed month (books are closed through %).', v_d, v_lock; END IF;
  END IF;
  PERFORM set_config('hub.cash_write', 'on', true);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.hub_cash_line(p jsonb, p_dir text, p_amt numeric, p_name text, p_class text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_conn uuid; v_d date := (p->>'entry_date')::date;
BEGIN
  SELECT connection_id INTO v_conn FROM public.plaid_accounts WHERE plaid_account_id = public.hub_cash_account();
  INSERT INTO public.bank_transactions (connection_id, wave_business_id, bank_source, plaid_transaction_id, account_id, date, posted_date, amount, amount_abs, direction, iso_currency,
    name, category, channel, pending, review_status, classification, raw)
  VALUES (v_conn, 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk', 'Cash on Hand', 'cash-' || gen_random_uuid()::text, public.hub_cash_account(), v_d, v_d,
    CASE WHEN p_dir = 'out' THEN p_amt ELSE -p_amt END, p_amt, p_dir, 'USD', left(p_name, 200), '', 'cash', false, 'reviewed', p_class,
    jsonb_build_object('source', 'cash_on_hand', 'person', btrim(p->>'person'), 'reference', btrim(p->>'reference'), 'note', p->>'note', 'entered_by', p->>'actor', 'request_id', p->>'request_id'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.hub_cash_finish(p jsonb, p_action text, p_fp text, p_entry uuid, p_res jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_low numeric; v_from date := (p->>'entry_date')::date;
BEGIN
  v_low := public.hub_cash_lowest_from(v_from);
  IF v_low < -0.005 THEN RAISE EXCEPTION 'HUB_GUARD: Cash on Hand would go below zero ($%) on or after % — there is not that much cash in the box.', to_char(v_low, 'FM999,999,990.00'), v_from; END IF;
  INSERT INTO public.hub_cash_requests (request_id, action, fingerprint, result, created_by) VALUES (p->>'request_id', p_action, p_fp, p_res, nullif(p->>'actor', '')::uuid);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'cash_' || p_action, 'cash_entry', p_entry::text,
    p_res || jsonb_build_object('person', p->>'person', 'reference', p->>'reference', 'note', p->>'note', 'date', p->>'entry_date', 'balance_after', public.hub_cash_balance(NULL)));
  RETURN p_res || jsonb_build_object('balance', public.hub_cash_balance(NULL));
END $$;

-- 5. a customer pays an invoice IN CASH (KTC USA invoices, USD; never more than the invoice still owes — no over-payment in cash)
CREATE OR REPLACE FUNCTION public.hub_cash_receive_invoice(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_amt numeric := round((p->>'amount')::numeric, 2); v_inv uuid := (p->>'invoice_id')::uuid; v_fp text; v_r jsonb; i record; v_paid numeric; v_bal numeric;
  v_line uuid; v_match uuid; v_pay uuid; v_entry uuid; v_st text;
BEGIN
  v_fp := md5(concat_ws('|', 'receive', v_inv::text, v_amt::text, p->>'entry_date'));
  v_r := public.hub_cash_begin(p, 'receive_invoice', v_fp); IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: the amount must be above zero.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-invoice:' || v_inv::text, 0));
  SELECT id, business_id, invoice_number, accounting_customer_id, total_amount, wave_imported_paid, record_status, currency, wave_business_id INTO i FROM public.accounting_invoices WHERE id = v_inv FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the invoice was not found.'; END IF;
  IF i.wave_business_id IS DISTINCT FROM 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk' THEN RAISE EXCEPTION 'HUB_GUARD: Cash on Hand is KTC USA''s — this invoice belongs to another company.'; END IF;
  IF coalesce(i.record_status, 'active') <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this invoice is % — it cannot take a payment.', i.record_status; END IF;
  IF upper(coalesce(i.currency, 'USD')) <> 'USD' THEN RAISE EXCEPTION 'HUB_GUARD: cash is in US dollars; this invoice is in %.', i.currency; END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.accounting_invoice_payments WHERE accounting_invoice_id = v_inv AND voided IS NOT TRUE AND coalesce(sync_status, '') <> 'void';
  v_bal := round(coalesce(i.total_amount, 0), 2) - round(coalesce(i.wave_imported_paid, 0), 2) - v_paid;
  IF v_amt > v_bal + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: invoice % only has $% left to pay — $% in cash would over-pay it.', coalesce(i.invoice_number, ''), to_char(greatest(v_bal, 0), 'FM999,999,990.00'), to_char(v_amt, 'FM999,999,990.00'); END IF;
  v_line := public.hub_cash_line(p, 'in', v_amt, 'Cash received — invoice ' || coalesce(i.invoice_number, '') || ' (' || btrim(p->>'reference') || ')', 'customer_payment');
  UPDATE public.bank_transactions SET matched_invoice_id = v_inv, linked_type = 'invoice', linked_id = v_inv, accounting_customer_id = i.accounting_customer_id WHERE id = v_line;
  INSERT INTO public.payment_matches (business_id, wave_business_id, bank_transaction_id, invoice_id, matched_amount, match_type, is_manual_override, notes, matched_by, created_by, accounting_customer_id)
  VALUES (i.business_id, i.wave_business_id, v_line, v_inv, v_amt, CASE WHEN v_amt >= v_bal - 0.005 THEN 'full' ELSE 'partial' END, false, 'cash received (Cash on Hand)', nullif(p->>'actor', '')::uuid, nullif(p->>'actor', '')::uuid, i.accounting_customer_id)
  RETURNING id INTO v_match;
  INSERT INTO public.accounting_invoice_payments (business_id, wave_business_id, accounting_invoice_id, accounting_customer_id, amount, payment_date, source, bank_transaction_id, payment_match_id, sync_status, memo, created_by)
  VALUES (i.business_id, i.wave_business_id, v_inv, i.accounting_customer_id, v_amt, (p->>'entry_date')::date, 'cash', v_line, v_match, 'pending_wave_sync', 'Cash — ' || btrim(p->>'reference'), nullif(p->>'actor', '')::uuid)
  RETURNING id INTO v_pay;
  v_paid := v_paid + v_amt; v_bal := greatest(0, round(coalesce(i.total_amount, 0), 2) - round(coalesce(i.wave_imported_paid, 0), 2) - v_paid);
  v_st := CASE WHEN v_paid + round(coalesce(i.wave_imported_paid, 0), 2) <= 0.0001 THEN 'unpaid' WHEN v_bal <= 0.0001 THEN 'paid' ELSE 'partial' END;
  UPDATE public.accounting_invoices SET amount_paid = round(coalesce(wave_imported_paid, 0), 2) + v_paid, balance_due = v_bal, payment_status = v_st WHERE id = v_inv;
  INSERT INTO public.cash_entries (kind, amount, entry_date, bank_transaction_id, invoice_id, invoice_payment_id, payment_match_id, person, reference, note, request_id, created_by)
  VALUES ('receive_invoice', v_amt, (p->>'entry_date')::date, v_line, v_inv, v_pay, v_match, btrim(p->>'person'), btrim(p->>'reference'), nullif(p->>'note', ''), p->>'request_id', nullif(p->>'actor', '')::uuid)
  RETURNING id INTO v_entry;
  RETURN public.hub_cash_finish(p, 'receive_invoice', v_fp, v_entry, jsonb_build_object('ok', true, 'action', 'receive_invoice', 'entry_id', v_entry, 'line_id', v_line, 'payment_id', v_pay, 'amount', v_amt, 'invoice_left', v_bal));
END $$;

-- 6. a bill is paid IN CASH (the existing payment caps apply: never more than the bill still owes)
CREATE OR REPLACE FUNCTION public.hub_cash_pay_bill(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_amt numeric := round((p->>'amount')::numeric, 2); v_bill uuid := (p->>'bill_id')::uuid; v_fp text; v_r jsonb; b record; v_line uuid; v_pay uuid; v_entry uuid;
BEGIN
  v_fp := md5(concat_ws('|', 'pay_bill', v_bill::text, v_amt::text, p->>'entry_date'));
  v_r := public.hub_cash_begin(p, 'pay_bill', v_fp); IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: the amount must be above zero.'; END IF;
  SELECT id, wave_business_id, vendor_name, bill_number, currency, record_status, disputed INTO b FROM public.vendor_bills WHERE id = v_bill;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill was not found.'; END IF;
  IF b.wave_business_id IS DISTINCT FROM 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk' THEN RAISE EXCEPTION 'HUB_GUARD: Cash on Hand is KTC USA''s — this bill belongs to another company.'; END IF;
  IF upper(coalesce(b.currency, 'USD')) <> 'USD' THEN RAISE EXCEPTION 'HUB_GUARD: cash is in US dollars; this bill is in %.', b.currency; END IF;
  IF b.disputed IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: this bill is disputed — settle the dispute first.'; END IF;
  v_line := public.hub_cash_line(p, 'out', v_amt, 'Cash paid — ' || coalesce(b.vendor_name, '') || ' ' || coalesce(b.bill_number, '') || ' (' || btrim(p->>'reference') || ')', 'vendor_payment');
  INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by, request_id)
  VALUES (v_bill, v_amt, (p->>'entry_date')::date, v_line, 'cash', nullif(p->>'actor', '')::uuid, p->>'request_id') RETURNING id INTO v_pay; -- the payment caps (open wires, credits, total) check this
  INSERT INTO public.cash_entries (kind, amount, entry_date, bank_transaction_id, bill_id, bill_payment_id, person, reference, note, request_id, created_by)
  VALUES ('pay_bill', v_amt, (p->>'entry_date')::date, v_line, v_bill, v_pay, btrim(p->>'person'), btrim(p->>'reference'), nullif(p->>'note', ''), p->>'request_id', nullif(p->>'actor', '')::uuid)
  RETURNING id INTO v_entry;
  RETURN public.hub_cash_finish(p, 'pay_bill', v_fp, v_entry, jsonb_build_object('ok', true, 'action', 'pay_bill', 'entry_id', v_entry, 'line_id', v_line, 'payment_id', v_pay, 'amount', v_amt));
END $$;

-- 7. cash taken to the bank: OUT of the cash box, paired with the bank's money-in line (now, or later with hub_cash_deposit_pair)
CREATE OR REPLACE FUNCTION public.hub_cash_pair_check(p_line uuid, p_amt numeric, p_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t record; v_other text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || p_line::text, 0));
  SELECT id, account_id, wave_business_id, direction, pending, review_status, amount_abs, coalesce(posted_date, date) AS d, matched_invoice_id, transfer_group_id, linked_id, upper(coalesce(iso_currency, 'USD')) AS cur
    INTO t FROM public.bank_transactions WHERE id = p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bank deposit line was not found.'; END IF;
  IF t.account_id = public.hub_cash_account() THEN RAISE EXCEPTION 'HUB_GUARD: pick the BANK line the cash was deposited into.'; END IF;
  IF t.wave_business_id IS DISTINCT FROM 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk' THEN RAISE EXCEPTION 'HUB_GUARD: that bank line belongs to another company.'; END IF;
  IF t.direction IS DISTINCT FROM 'in' OR t.pending IS TRUE OR t.review_status = 'duplicate' OR t.cur <> 'USD' THEN RAISE EXCEPTION 'HUB_GUARD: a cash deposit is a settled USD money-in bank line.'; END IF;
  IF abs(round(t.amount_abs, 2) - p_amt) > 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the bank line is $% — the cash deposit is $%; they must be the same amount.', to_char(round(t.amount_abs, 2), 'FM999,999,990.00'), to_char(p_amt, 'FM999,999,990.00'); END IF;
  IF t.d < p_date THEN RAISE EXCEPTION 'HUB_GUARD: the bank line (%) is before the cash left the box (%).', t.d, p_date; END IF;
  -- (Codex 24 Nov) the bank line must be otherwise UNALLOCATED: the shared check (same semantics as Bank Review), under the bank-line lock
  v_other := public.hub_bank_line_other_use(p_line);
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'HUB_GUARD: this deposit already has another use — %. Undo that allocation first; nothing was changed.', v_other; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hub_cash_deposit(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_amt numeric := round((p->>'amount')::numeric, 2); v_bank uuid := nullif(p->>'bank_transaction_id', '')::uuid; v_fp text; v_r jsonb; v_line uuid; v_entry uuid; v_grp uuid;
BEGIN
  v_fp := md5(concat_ws('|', 'deposit', v_amt::text, p->>'entry_date', coalesce(v_bank::text, '')));
  v_r := public.hub_cash_begin(p, 'deposit', v_fp); IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: the amount must be above zero.'; END IF;
  IF v_bank IS NOT NULL THEN PERFORM public.hub_cash_pair_check(v_bank, v_amt, (p->>'entry_date')::date); END IF;
  v_line := public.hub_cash_line(p, 'out', v_amt, 'Cash deposited to the bank (' || btrim(p->>'reference') || ')', 'transfer');
  IF v_bank IS NOT NULL THEN
    v_grp := gen_random_uuid();
    UPDATE public.bank_transactions SET transfer_group_id = v_grp, classification = 'transfer' WHERE id IN (v_line, v_bank);
  END IF;
  INSERT INTO public.cash_entries (kind, amount, entry_date, bank_transaction_id, deposit_bank_transaction_id, person, reference, note, request_id, created_by)
  VALUES ('deposit', v_amt, (p->>'entry_date')::date, v_line, v_bank, btrim(p->>'person'), btrim(p->>'reference'), nullif(p->>'note', ''), p->>'request_id', nullif(p->>'actor', '')::uuid)
  RETURNING id INTO v_entry;
  RETURN public.hub_cash_finish(p, 'deposit', v_fp, v_entry, jsonb_build_object('ok', true, 'action', 'deposit', 'entry_id', v_entry, 'line_id', v_line, 'paired', v_bank IS NOT NULL, 'amount', v_amt));
END $$;

-- 7b. pair a deposit recorded earlier with the bank line once it arrives
CREATE OR REPLACE FUNCTION public.hub_cash_deposit_pair(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e record; v_bank uuid := (p->>'bank_transaction_id')::uuid; v_grp uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-cash-box', 0));
  SELECT * INTO e FROM public.cash_entries WHERE id = (p->>'entry_id')::uuid FOR UPDATE;
  IF NOT FOUND OR e.kind <> 'deposit' THEN RAISE EXCEPTION 'HUB_GUARD: that is not a cash deposit.'; END IF;
  IF e.voided IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: that deposit was undone.'; END IF;
  IF e.deposit_bank_transaction_id IS NOT NULL THEN
    IF e.deposit_bank_transaction_id = v_bank THEN RETURN jsonb_build_object('ok', true, 'action', 'deposit_pair', 'entry_id', e.id, 'repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: this deposit is already paired with a bank line.';
  END IF;
  PERFORM public.hub_cash_pair_check(v_bank, e.amount, e.entry_date);
  PERFORM set_config('hub.cash_write', 'on', true);
  v_grp := gen_random_uuid();
  UPDATE public.bank_transactions SET transfer_group_id = v_grp, classification = 'transfer' WHERE id IN (e.bank_transaction_id, v_bank);
  UPDATE public.cash_entries SET deposit_bank_transaction_id = v_bank WHERE id = e.id;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'cash_deposit_pair', 'cash_entry', e.id::text, jsonb_build_object('bank_transaction_id', v_bank, 'amount', e.amount));
  RETURN jsonb_build_object('ok', true, 'action', 'deposit_pair', 'entry_id', e.id);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- SHARED by v55.83-YD and v55.83-YF (Codex 24 Nov: "only an otherwise unallocated bank line"; identical text in both scripts, whichever runs
-- later re-creates the same functions). ONE BANK LINE, ONE USE: a money-in bank line taken WHOLE as a vendor credit refund (YD) or paired
-- with cash taken to the bank (YF) may have no other allocation — no invoice payment / match, split, open parked deposit, open customer
-- credit, RTM / NextTrade money back, other refund or cash deposit, invoice match, transfer pair or link — and, while it is that, none can
-- be added. Nothing existing is ever removed to make room: the person undoes the other use first.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- what else is using this bank line (NULL = nothing). Optional tables are looked up only when they exist.
CREATE OR REPLACE FUNCTION public.hub_bank_line_other_use(p_line uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t record; v_n int;
BEGIN
  SELECT matched_invoice_id, transfer_group_id, linked_id INTO t FROM public.bank_transactions WHERE id = p_line;
  IF NOT FOUND THEN RETURN 'the bank line was not found'; END IF;
  IF t.matched_invoice_id IS NOT NULL THEN RETURN 'it is matched to an invoice'; END IF;
  IF t.transfer_group_id IS NOT NULL THEN RETURN 'it is paired as a transfer between own accounts'; END IF;
  IF t.linked_id IS NOT NULL THEN RETURN 'it is linked to another record'; END IF;
  IF to_regclass('public.accounting_invoice_payments') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.accounting_invoice_payments where bank_transaction_id = $1 and voided is not true and coalesce(sync_status, '''') <> ''void''' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it is a customer payment on an invoice'; END IF; END IF;
  IF to_regclass('public.payment_matches') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.payment_matches where bank_transaction_id = $1 and voided is not true' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it is matched to an invoice'; END IF; END IF;
  IF to_regclass('public.bank_transaction_splits') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.bank_transaction_splits where bank_transaction_id = $1' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it is split into lines'; END IF; END IF;
  IF to_regclass('public.unapplied_deposits') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.unapplied_deposits where bank_transaction_id = $1 and (status is null or status = ''open'')' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it is parked as an unapplied customer deposit'; END IF; END IF;
  IF to_regclass('public.customer_credits') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.customer_credits where source_transaction_id = $1 and (status is null or status = ''open'')' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it holds an open customer credit'; END IF; END IF;
  IF to_regclass('public.party_money_entries') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.party_money_entries where bank_transaction_id = $1 and kind = ''refund''' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it is money back from RTM / NextTrade'; END IF; END IF;
  IF to_regclass('public.vendor_credit_applications') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.vendor_credit_applications where kind = ''refund'' and bank_transaction_id = $1 and voided is not true' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it is a vendor credit refund'; END IF; END IF;
  IF to_regclass('public.cash_entries') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.cash_entries where deposit_bank_transaction_id = $1 and voided is not true' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'it is cash taken to the bank'; END IF; END IF;
  RETURN NULL;
END $$;

-- is this line taken WHOLE by a vendor credit refund or a cash deposit? (NULL = no)
CREATE OR REPLACE FUNCTION public.hub_bank_line_exclusive_use(p_line uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int;
BEGIN
  IF p_line IS NULL THEN RETURN NULL; END IF;
  IF to_regclass('public.vendor_credit_applications') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.vendor_credit_applications where kind = ''refund'' and bank_transaction_id = $1 and voided is not true' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'a vendor credit refund'; END IF; END IF;
  IF to_regclass('public.cash_entries') IS NOT NULL THEN
    EXECUTE 'select count(*) from public.cash_entries where deposit_bank_transaction_id = $1 and voided is not true' INTO v_n USING p_line;
    IF v_n > 0 THEN RETURN 'cash taken to the bank'; END IF; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.hub_bank_line_other_use(uuid), public.hub_bank_line_exclusive_use(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_bank_line_other_use(uuid), public.hub_bank_line_exclusive_use(uuid) TO service_role;

-- the reverse: while a line is a vendor refund or a cash deposit, no allocation can be added to it (any screen, any route)
CREATE OR REPLACE FUNCTION public.hub_bank_line_exclusive_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_line uuid; v_new jsonb := to_jsonb(NEW); v_old jsonb; v_use text; v_active boolean := false;
BEGIN
  IF coalesce(current_setting('hub.cash_write', true), '') = 'on' THEN RETURN NEW; END IF; -- the cash functions pair / unpair their own lines
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_TABLE_NAME = 'bank_transactions' THEN
    v_line := NEW.id;
    v_active := (v_new->>'matched_invoice_id' IS NOT NULL AND v_new->'matched_invoice_id' IS DISTINCT FROM v_old->'matched_invoice_id')
             OR (v_new->>'transfer_group_id' IS NOT NULL AND v_new->'transfer_group_id' IS DISTINCT FROM v_old->'transfer_group_id')
             OR (v_new->>'linked_id' IS NOT NULL AND v_new->'linked_id' IS DISTINCT FROM v_old->'linked_id');
  ELSIF TG_TABLE_NAME = 'customer_credits' THEN
    v_line := nullif(v_new->>'source_transaction_id', '')::uuid; v_active := (v_new->>'status' IS NULL OR v_new->>'status' = 'open');
  ELSIF TG_TABLE_NAME IN ('unapplied_deposits') THEN
    v_line := nullif(v_new->>'bank_transaction_id', '')::uuid; v_active := (v_new->>'status' IS NULL OR v_new->>'status' = 'open');
  ELSIF TG_TABLE_NAME IN ('accounting_invoice_payments', 'payment_matches') THEN
    v_line := nullif(v_new->>'bank_transaction_id', '')::uuid; v_active := coalesce((v_new->>'voided')::boolean, false) IS NOT TRUE;
  ELSIF TG_TABLE_NAME = 'party_money_entries' THEN
    v_line := nullif(v_new->>'bank_transaction_id', '')::uuid; v_active := (v_new->>'kind' = 'refund');
  ELSE -- bank_transaction_splits
    v_line := nullif(v_new->>'bank_transaction_id', '')::uuid; v_active := true;
  END IF;
  IF NOT v_active OR v_line IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_line::text, 0));
  v_use := public.hub_bank_line_exclusive_use(v_line);
  IF v_use IS NOT NULL THEN RAISE EXCEPTION 'HUB_GUARD: this bank line is % — undo that first; then it can be allocated.', v_use; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bank_line_exclusive_guard() FROM public, anon, authenticated;
DO $x$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('bank_transactions', 'BEFORE UPDATE OF matched_invoice_id, transfer_group_id, linked_id'),
      ('accounting_invoice_payments', 'BEFORE INSERT OR UPDATE OF bank_transaction_id, voided'),
      ('payment_matches', 'BEFORE INSERT OR UPDATE OF bank_transaction_id, voided'),
      ('bank_transaction_splits', 'BEFORE INSERT OR UPDATE OF bank_transaction_id'),
      ('unapplied_deposits', 'BEFORE INSERT OR UPDATE OF bank_transaction_id, status'),
      ('customer_credits', 'BEFORE INSERT OR UPDATE OF source_transaction_id, status'),
      ('party_money_entries', 'BEFORE INSERT')) v(tbl, timing) LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL THEN
      EXECUTE 'DROP TRIGGER IF EXISTS hub_bank_line_exclusive ON public.' || r.tbl;
      EXECUTE 'CREATE TRIGGER hub_bank_line_exclusive ' || r.timing || ' ON public.' || r.tbl || ' FOR EACH ROW EXECUTE FUNCTION public.hub_bank_line_exclusive_guard()';
    END IF;
  END LOOP;
END $x$;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 8. a cash count / opening float (in) or a shortfall written off (out): a reason is required (super admin only, in the Hub)
CREATE OR REPLACE FUNCTION public.hub_cash_adjust(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_amt numeric := round((p->>'amount')::numeric, 2); v_dir text := p->>'direction'; v_fp text; v_r jsonb; v_line uuid; v_entry uuid;
BEGIN
  v_fp := md5(concat_ws('|', 'adjust', v_dir, v_amt::text, p->>'entry_date'));
  v_r := public.hub_cash_begin(p, 'adjust', v_fp); IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF v_dir NOT IN ('in', 'out') THEN RAISE EXCEPTION 'HUB_GUARD: say whether cash is added or taken out.'; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: the amount must be above zero.'; END IF;
  IF length(btrim(coalesce(p->>'note', ''))) < 5 THEN RAISE EXCEPTION 'HUB_GUARD: a cash count change needs the reason, in a few words.'; END IF;
  v_line := public.hub_cash_line(p, v_dir, v_amt, CASE WHEN v_dir = 'in' THEN 'Cash counted in — ' ELSE 'Cash taken out — ' END || btrim(p->>'note'), NULL);
  INSERT INTO public.cash_entries (kind, amount, entry_date, bank_transaction_id, person, reference, note, request_id, created_by)
  VALUES (CASE WHEN v_dir = 'in' THEN 'adjust_in' ELSE 'adjust_out' END, v_amt, (p->>'entry_date')::date, v_line, btrim(p->>'person'), btrim(p->>'reference'), btrim(p->>'note'), p->>'request_id', nullif(p->>'actor', '')::uuid)
  RETURNING id INTO v_entry;
  RETURN public.hub_cash_finish(p, 'adjust', v_fp, v_entry, jsonb_build_object('ok', true, 'action', 'adjust', 'entry_id', v_entry, 'line_id', v_line, 'amount', v_amt, 'direction', v_dir));
END $$;

-- 9. UNDO one cash entry: its payment is voided (the invoice / bill owes again), a deposit is unpaired, and the cash line is taken out
--    (review_status 'duplicate' + a note — every report already leaves those out). Refused when the invoice payment is already in Wave
--    (undo it in Wave first, same rule as unmatching a bank deposit), inside a closed month, or when the box would go below zero.
CREATE OR REPLACE FUNCTION public.hub_cash_undo(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e record; v_lock date; ap record; v_paid numeric; v_bal numeric; v_st text; i record; v_low numeric;
BEGIN
  IF length(btrim(coalesce(p->>'reason', ''))) < 3 THEN RAISE EXCEPTION 'HUB_GUARD: say why, in a few words.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-cash-box', 0));
  SELECT * INTO e FROM public.cash_entries WHERE id = (p->>'entry_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: that cash entry was not found.'; END IF;
  IF e.voided IS TRUE THEN RETURN jsonb_build_object('ok', true, 'action', 'undo', 'entry_id', e.id, 'repeat', true); END IF;
  IF to_regclass('clickbooks_us.books') IS NOT NULL THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO v_lock;
    IF v_lock IS NOT NULL AND e.entry_date <= v_lock THEN RAISE EXCEPTION 'HUB_GUARD: this cash entry is dated %, inside a closed month (closed through %). Reopen the month first.', e.entry_date, v_lock; END IF;
  END IF;
  PERFORM set_config('hub.cash_write', 'on', true);
  IF e.kind = 'receive_invoice' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-invoice:' || e.invoice_id::text, 0));
    SELECT * INTO ap FROM public.accounting_invoice_payments WHERE id = e.invoice_payment_id FOR UPDATE;
    IF ap.wave_payment_id IS NOT NULL OR ap.sync_status IN ('synced', 'manual_done') THEN RAISE EXCEPTION 'HUB_GUARD: this cash payment is already in Wave — remove it in Wave first, then undo it here.'; END IF;
    UPDATE public.accounting_invoice_payments SET voided = true, voided_at = now(), voided_by = nullif(p->>'actor', '')::uuid, sync_status = 'void' WHERE id = e.invoice_payment_id;
    UPDATE public.payment_matches SET voided = true, voided_at = now(), voided_by = nullif(p->>'actor', '')::uuid WHERE id = e.payment_match_id;
    SELECT total_amount, wave_imported_paid INTO i FROM public.accounting_invoices WHERE id = e.invoice_id FOR UPDATE;
    SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.accounting_invoice_payments WHERE accounting_invoice_id = e.invoice_id AND voided IS NOT TRUE AND coalesce(sync_status, '') <> 'void';
    v_bal := greatest(0, round(coalesce(i.total_amount, 0), 2) - round(coalesce(i.wave_imported_paid, 0), 2) - v_paid);
    v_st := CASE WHEN v_paid + round(coalesce(i.wave_imported_paid, 0), 2) <= 0.0001 THEN 'unpaid' WHEN v_bal <= 0.0001 THEN 'paid' ELSE 'partial' END;
    UPDATE public.accounting_invoices SET amount_paid = round(coalesce(wave_imported_paid, 0), 2) + v_paid, balance_due = v_bal, payment_status = v_st WHERE id = e.invoice_id;
    UPDATE public.bank_transactions SET matched_invoice_id = NULL, linked_type = NULL, linked_id = NULL WHERE id = e.bank_transaction_id;
  ELSIF e.kind = 'pay_bill' THEN
    UPDATE public.vendor_bill_payments SET voided = true WHERE id = e.bill_payment_id;
  ELSIF e.kind = 'deposit' AND e.deposit_bank_transaction_id IS NOT NULL THEN
    UPDATE public.bank_transactions SET transfer_group_id = NULL, classification = NULL WHERE id IN (e.bank_transaction_id, e.deposit_bank_transaction_id);
  END IF;
  UPDATE public.bank_transactions SET review_status = 'duplicate', notes = trim(both ' ' from coalesce(notes, '') || ' [cash entry undone ' || to_char(now(), 'YYYY-MM-DD') || ': ' || btrim(p->>'reason') || ']') WHERE id = e.bank_transaction_id;
  UPDATE public.cash_entries SET voided = true, void_reason = btrim(p->>'reason'), voided_by = nullif(p->>'actor', '')::uuid, voided_at = now() WHERE id = e.id;
  v_low := public.hub_cash_lowest_from(e.entry_date);
  IF v_low < -0.005 THEN RAISE EXCEPTION 'HUB_GUARD: undoing this would take Cash on Hand below zero ($%) — undo the later cash payments / deposits first.', to_char(v_low, 'FM999,999,990.00'); END IF;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (nullif(p->>'actor', '')::uuid, 'cash_undo', 'cash_entry', e.id::text,
    jsonb_build_object('kind', e.kind, 'amount', e.amount, 'date', e.entry_date, 'reason', btrim(p->>'reason'), 'balance_after', public.hub_cash_balance(NULL)));
  RETURN jsonb_build_object('ok', true, 'action', 'undo', 'entry_id', e.id, 'balance', public.hub_cash_balance(NULL));
END $$;

REVOKE ALL ON FUNCTION public.hub_cash_begin(jsonb, text, text), public.hub_cash_line(jsonb, text, numeric, text, text), public.hub_cash_finish(jsonb, text, text, uuid, jsonb), public.hub_cash_pair_check(uuid, numeric, date),
  public.hub_cash_receive_invoice(jsonb), public.hub_cash_pay_bill(jsonb), public.hub_cash_deposit(jsonb), public.hub_cash_deposit_pair(jsonb), public.hub_cash_adjust(jsonb), public.hub_cash_undo(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_cash_receive_invoice(jsonb), public.hub_cash_pay_bill(jsonb), public.hub_cash_deposit(jsonb), public.hub_cash_deposit_pair(jsonb), public.hub_cash_adjust(jsonb), public.hub_cash_undo(jsonb) TO service_role;

-- 9b. the "Cash on Hand: record" switch (cash.manage) is sensitive: only the super admin can switch it on (its OWN guard, so it never
--     replaces the shared sensitive-switch list another release may also extend)
DO $g$ BEGIN
  IF to_regclass('public.module_permissions') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.hub_guard_cash_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
    BEGIN
      IF NEW.has_access IS TRUE AND NEW.module_name = 'cash.manage' THEN
        IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN RETURN NEW; END IF;
        IF NOT public.hub_caller_is_super_admin() THEN RAISE EXCEPTION 'HUB_GUARD: only the super admin can switch on "cash.manage".'; END IF;
      END IF;
      RETURN NEW;
    END $f$;
    REVOKE ALL ON FUNCTION public.hub_guard_cash_grant() FROM public, anon, authenticated;
    DROP TRIGGER IF EXISTS hub_guard_cash_grant ON public.module_permissions;
    CREATE TRIGGER hub_guard_cash_grant BEFORE INSERT OR UPDATE OF has_access, module_name ON public.module_permissions FOR EACH ROW EXECUTE FUNCTION public.hub_guard_cash_grant();
  END IF;
END $g$;

-- 10. the Hub asks this before showing the cash screens
CREATE OR REPLACE FUNCTION public.hub_cash_installed() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regclass('public.cash_entries') IS NOT NULL AND EXISTS (SELECT 1 FROM public.plaid_accounts WHERE plaid_account_id = 'manual-acct-cash-on-hand-us' AND is_private IS TRUE)
     AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_cash_line_guard') $$;
GRANT EXECUTE ON FUNCTION public.hub_cash_installed() TO service_role, authenticated;

-- 11. check (read-only): every line should say OK (the ledger line says MAPPED or NOT MAPPED — not mapped = the ledger skips cash lines)
SELECT 'Cash on Hand account (private, KTC USA)' AS what, CASE WHEN EXISTS (SELECT 1 FROM public.plaid_accounts WHERE plaid_account_id = 'manual-acct-cash-on-hand-us' AND is_private IS TRUE AND wave_business_id = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk') THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'cash lines only through the functions', CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('hub_cash_line_guard', 'hub_cash_link_guard')) >= 4 THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'only the Hub server records cash', CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_cash_pay_bill(jsonb)', 'EXECUTE') AND NOT has_table_privilege('authenticated', 'public.cash_entries', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'ledger map to "Cash on Hand"', CASE WHEN to_regclass('clickbooks_us.bank_ledger_map') IS NULL THEN 'NO LEDGER' WHEN EXISTS (SELECT 1 FROM clickbooks_us.bank_ledger_map WHERE provider_account_id = 'manual-acct-cash-on-hand-us') THEN 'MAPPED' ELSE 'NOT MAPPED' END
UNION ALL SELECT 'installed flag', CASE WHEN public.hub_cash_installed() THEN 'OK' ELSE 'PROBLEM' END;
