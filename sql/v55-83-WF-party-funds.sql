-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-WF — FUNDS WITH RTM / NEXTTRADE: the database step (Max, 20 Nov 2026; plan + Amendment 1 reviewed by Codex)
--   Money KTC sends RTM or NextTrade is FUNDING held by that company. Every dollar used comes from one identified transfer.
--   1. ONE calculation of "what is left on this transfer" (hub_party_transfer_state). The wire screen's summary is now the
--      same calculation, so every screen and every writer sees the same number.
--   2. A transfer is spendable only once it is CONFIRMED as funds held by that company (party_funding_transfers). Until then it
--      is "needs reconciliation": bills it already paid can still be LINKED to it, but nothing new can be drawn from it.
--   3. A request not sent yet RESERVES its whole commitment (its bills and its fee) on the transfer.
--   4. "Services rendered" is an explicit, reversible entry tied to its transfer (hub_party_fee). A reversal undoes ONE named
--      fee and can never exceed what is left of it. No payment is created in either direction.
--   5. No writer can take a transfer below zero: one deferred check on bill payments, fee entries, requests and request lines.
--   6. Retired for NEW entries (old rows stay readable, nothing is removed): the pool "advance" split and the pool-level
--      advance ⇄ fee and advance → bill moves. Money not used on a transfer is simply still held on that transfer.
-- Adds two columns, one small status table, functions and triggers. Changes NO existing row. Nothing is deleted.
-- Needs (already installed): TO payment guards, SP funded requests (amended), TX advances, UD pay-NextTrade, US partial wires.
-- Safe to run more than once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. every fee / refund entry names the transfer it belongs to; an entry can point at the wire request it describes
ALTER TABLE public.party_money_entries ADD COLUMN IF NOT EXISTS source_bank_transaction_id uuid;
ALTER TABLE public.party_money_entries ADD COLUMN IF NOT EXISTS wire_package_id uuid;
ALTER TABLE public.party_money_entries DROP CONSTRAINT IF EXISTS party_money_entries_kind_check;
ALTER TABLE public.party_money_entries ADD CONSTRAINT party_money_entries_kind_check
  CHECK (kind IN ('payment_split','apply_to_bill','advance_to_fee','fee_to_advance','opening_balance','fee_from_transfer','fee_back_to_transfer','refund'));
ALTER TABLE public.party_money_entries DROP CONSTRAINT IF EXISTS party_money_entries_bucket_check;
ALTER TABLE public.party_money_entries ADD CONSTRAINT party_money_entries_bucket_check CHECK (bucket IN ('advance','fee','refund'));
CREATE INDEX IF NOT EXISTS party_money_entries_source ON public.party_money_entries (source_bank_transaction_id) WHERE source_bank_transaction_id IS NOT NULL;

-- 2. is this transfer confirmed as funds held by the company? (a STATUS only — it holds no amount)
CREATE TABLE IF NOT EXISTS public.party_funding_transfers (
  bank_transaction_id uuid PRIMARY KEY,
  party text NOT NULL,
  state text NOT NULL CHECK (state IN ('confirmed','needs_reconciliation')),
  note text,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.party_funding_transfers ENABLE ROW LEVEL SECURITY;

-- 3. THE ONE CALCULATION. p_except leaves one request out ("what if this one changes / is sent").
--    held      = the transfer − refunds − bills paid from it − explicit fees          (money still with the company)
--    reserved  = bills + fee of every request drawn from it that is not sent yet      (held, promised, not paid)
--    available = held − reserved, and only when the transfer is confirmed             (what a new request or fee may take)
--    A wire fee is counted from the wire itself (sent requests, old and new) — exactly once: an entry that points at a
--    wire (wire_package_id) is a note about that fee, never a second fee.
CREATE OR REPLACE FUNCTION public.hub_party_transfer_state(p_txn uuid, p_except uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE t record; amt numeric; pays numeric; wfees numeric; efees numeric; refunds numeric; resv numeric; reqs int; v_party text; v_state text; held numeric; avail numeric;
BEGIN
  SELECT b.id, b.amount_abs, b.third_party_payer INTO t FROM public.bank_transactions b WHERE b.id = p_txn;
  IF t.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  amt := round(abs(coalesce(t.amount_abs, 0)), 2);
  v_party := nullif(trim(coalesce(t.third_party_payer, '')), '');
  SELECT coalesce(sum(round(p.amount, 2)), 0) INTO pays
    FROM public.vendor_bill_payments p
   WHERE p.bank_transaction_id = p_txn AND p.voided IS NOT TRUE
     AND (p_except IS NULL OR NOT EXISTS (SELECT 1 FROM public.wire_package_lines l WHERE l.payment_id = p.id AND l.package_id = p_except));
  SELECT coalesce(sum(round(coalesce(w.fee_amount, 0), 2)), 0), count(*) INTO wfees, reqs
    FROM public.wire_packages w
   WHERE w.bank_transaction_id = p_txn AND w.status = 'attached' AND (p_except IS NULL OR w.id <> p_except);
  SELECT coalesce(sum(round(e.amount, 2)), 0) INTO efees
    FROM public.party_money_entries e
   WHERE e.bucket = 'fee' AND e.wire_package_id IS NULL AND coalesce(e.source_bank_transaction_id, e.bank_transaction_id) = p_txn;
  SELECT coalesce(sum(round(e.amount, 2)), 0) INTO refunds
    FROM public.party_money_entries e WHERE e.bucket = 'refund' AND e.source_bank_transaction_id = p_txn;
  SELECT coalesce(sum(round(coalesce(w.fee_amount, 0), 2)
           + coalesce((SELECT sum(round(l.amount, 2)) FROM public.wire_package_lines l WHERE l.package_id = w.id AND l.is_open IS NOT FALSE), 0)), 0) INTO resv
    FROM public.wire_packages w
   WHERE w.funding_txn_id = p_txn AND w.status = 'draft' AND (p_except IS NULL OR w.id <> p_except);
  held := amt - refunds - pays - wfees - efees;
  IF v_party IS NULL THEN
    v_state := 'not_a_company_transfer'; avail := held - resv;          -- an ordinary bank line: as before, no confirmation step
  ELSE
    SELECT f.state INTO v_state FROM public.party_funding_transfers f WHERE f.bank_transaction_id = p_txn;
    v_state := coalesce(v_state, 'needs_reconciliation');               -- not confirmed yet = not spendable
    avail := CASE WHEN v_state = 'confirmed' THEN held - resv ELSE 0 END;
  END IF;
  RETURN jsonb_build_object('found', true, 'party', v_party, 'status', v_state, 'amount', amt, 'refunds', refunds, 'bills', pays, 'fees', wfees + efees,
                            'wire_fees', wfees, 'entry_fees', efees, 'used', pays + wfees + efees, 'held', held, 'reserved', resv, 'available', avail,
                            'remaining', avail, 'requests', reqs);
END $fn$;

-- the wire screen's summary IS that calculation (same keys as before: found, amount, bills, fees, used, remaining, requests)
CREATE OR REPLACE FUNCTION public.wire_funding_summary(p_txn uuid, p_except uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$ SELECT public.hub_party_transfer_state(p_txn, p_except) $fn$;

-- 4. sending a request: the request's OWN reservation is left out of the check (it is about to be used), every OTHER
--    reservation stays; a transfer that is not confirmed cannot be drawn from. Everything else is the SP function, unchanged.
CREATE OR REPLACE FUNCTION public.wire_request_send(p_pkg uuid, p_actor uuid, p_sent_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  w public.wire_packages%ROWTYPE;
  tj jsonb; t_date date; t_amt numeric; s jsonb;
  ln record; bl record; paid numeric; bills_total numeric := 0; total numeric; n int := 0; pid uuid;
  lock_through date; norm_a text; norm_b text;
BEGIN
  SELECT * INTO w FROM public.wire_packages WHERE id = p_pkg FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'why', 'Request not found.'); END IF;
  IF w.funding_txn_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'This wire does not draw from a transfer.'); END IF;
  IF w.status <> 'draft' THEN RETURN jsonb_build_object('ok', false, 'why', 'This request is already ' || w.status || '.'); END IF;
  IF w.signoff1_by IS NULL OR w.signoff2_by IS NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'Both signatures are needed before a request is sent.'); END IF;
  IF p_actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'Who is sending it?'); END IF;
  IF p_sent_date IS NULL OR p_sent_date > current_date THEN RETURN jsonb_build_object('ok', false, 'why', 'The date the request was sent is required and cannot be in the future.'); END IF;

  -- v55.83-VA (Codex 06:18) — the same order as every other writer on a bank line: its advisory lock FIRST, then its row
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || w.funding_txn_id::text, 0));
  SELECT to_jsonb(t) INTO tj FROM public.bank_transactions t WHERE t.id = w.funding_txn_id FOR UPDATE;
  IF tj IS NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'The transfer this request draws from is no longer in the books.'); END IF;
  IF coalesce(tj->>'direction', '') <> 'out' THEN RETURN jsonb_build_object('ok', false, 'why', 'That bank line is money in — a transfer to ' || w.payee_name || ' is money out.'); END IF;
  IF (tj->>'pending')::boolean IS TRUE THEN RETURN jsonb_build_object('ok', false, 'why', 'That transfer is still pending at the bank — send the request once it settles.'); END IF;
  IF coalesce(tj->>'review_status', '') = 'duplicate' THEN RETURN jsonb_build_object('ok', false, 'why', 'That bank line is marked a duplicate copy.'); END IF;
  IF nullif(tj->>'transfer_group_id', '') IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'That bank line is linked as a transfer between our own accounts — it cannot also pay bills. Unlink it first.'); END IF;
  norm_a := trim(regexp_replace(lower(coalesce(tj->>'third_party_payer', '')), '[^a-z0-9]+', ' ', 'g'));
  norm_b := trim(regexp_replace(lower(coalesce(w.payee_name, '')), '[^a-z0-9]+', ' ', 'g'));
  IF norm_a = '' OR norm_a <> norm_b THEN RETURN jsonb_build_object('ok', false, 'why', 'That transfer is not marked as sent to ' || w.payee_name || '. Mark it first (All Transactions).'); END IF;
  t_date := coalesce(nullif(tj->>'posted_date', '')::date, nullif(tj->>'date', '')::date);
  t_amt := round(abs(coalesce((tj->>'amount_abs')::numeric, 0)), 2);

  -- a closed month stays closed: the bill payments would be dated inside it
  IF to_regclass('clickbooks_us.books') IS NOT NULL AND t_date IS NOT NULL THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO lock_through;
    IF lock_through IS NOT NULL AND t_date <= lock_through THEN
      RETURN jsonb_build_object('ok', false, 'why', 'The transfer is dated ' || t_date || ', inside a closed month (books are closed through ' || lock_through || '). Reopen the month first (Accounting → Month-end).', 'blocked_by', 'closed month');
    END IF;
  END IF;

  FOR ln IN SELECT * FROM public.wire_package_lines l WHERE l.package_id = w.id ORDER BY l.created_at, l.id LOOP
    SELECT vb.id, vb.vendor_name, vb.bill_number, vb.total_amount, vb.record_status INTO bl FROM public.vendor_bills vb WHERE vb.id = ln.bill_id;
    IF NOT FOUND OR bl.record_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('ok', false, 'why', 'A bill on this request was voided or deleted after approval. Nothing was recorded.');
    END IF;
    SELECT coalesce(sum(p.amount), 0) INTO paid FROM public.vendor_bill_payments p WHERE p.bill_id = ln.bill_id AND p.voided IS NOT TRUE;
    IF round(ln.amount, 2) > round(coalesce(bl.total_amount, 0) - paid, 2) + 0.005 THEN
      RETURN jsonb_build_object('ok', false, 'why', coalesce(bl.vendor_name, 'A bill') || ' ' || coalesce(bl.bill_number, '') || ' was paid some other way after approval — this request would overpay it. Nothing was recorded.');
    END IF;
    bills_total := bills_total + round(ln.amount, 2); n := n + 1;
  END LOOP;
  IF n = 0 THEN RETURN jsonb_build_object('ok', false, 'why', 'This request has no bills.'); END IF;

  total := bills_total + round(coalesce(w.fee_amount, 0), 2);
  s := public.wire_funding_summary(w.funding_txn_id, w.id); -- v55.83-WF: this request's own reservation is left out; every other one counts
  IF coalesce(s->>'status', '') = 'needs_reconciliation' THEN -- v55.83-WF
    RETURN jsonb_build_object('ok', false, 'why', 'This transfer is not confirmed as funds held by ' || w.payee_name || ' yet. Confirm it first (Funds with ' || w.payee_name || '), then send the request.', 'blocked_by', 'transfer not confirmed');
  END IF;
  IF total > (s->>'remaining')::numeric + 0.005 THEN
    RETURN jsonb_build_object('ok', false, 'why', 'This request is $' || to_char(total, 'FM999,999,990.00') || ' (bills $' || to_char(bills_total, 'FM999,999,990.00') || ' + service fee $' || to_char(coalesce(w.fee_amount, 0), 'FM999,999,990.00')
      || ') but only $' || to_char((s->>'remaining')::numeric, 'FM999,999,990.00') || ' is left on the $' || to_char(t_amt, 'FM999,999,990.00') || ' transfer. Lower a bill or the fee, or use another transfer.', 'blocked_by', 'over the transfer',
      'remaining', (s->>'remaining')::numeric);
  END IF;

  FOR ln IN SELECT * FROM public.wire_package_lines l WHERE l.package_id = w.id ORDER BY l.created_at, l.id LOOP
    INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by)
    VALUES (ln.bill_id, round(ln.amount, 2), t_date, w.funding_txn_id, 'rtm', p_actor) RETURNING id INTO pid;
    UPDATE public.wire_package_lines SET is_open = false, payment_id = pid WHERE id = ln.id;
    IF ln.marked_paid_via IS TRUE THEN
      UPDATE public.vendor_bills SET paid_via = w.payee_name WHERE id = ln.bill_id AND paid_via IS NULL;
    END IF;
  END LOOP;

  UPDATE public.wire_packages
     SET status = 'attached', approved_total = total, sent_by = p_actor, sent_at = now(), sent_date = p_sent_date,
         bank_reference = left('request to ' || w.payee_name, 80), bank_transaction_id = w.funding_txn_id,
         attached_by = p_actor, attached_at = now(),
         attach_note = left('drawn from the transfer of ' || coalesce(t_date::text, '?'), 500), updated_at = now()
   WHERE id = w.id;

  RETURN jsonb_build_object('ok', true, 'bills_paid', n, 'bills_total', bills_total, 'fee', round(coalesce(w.fee_amount, 0), 2), 'total', total,
                            'paid_date', t_date, 'transfer_amount', t_amt, 'remaining_after', (s->>'remaining')::numeric - total);
END $fn$;

-- 5. NO WRITER CAN TAKE A TRANSFER BELOW ZERO. One deferred check, whatever wrote the row (a bill payment, a fee entry, a
--    request, a request line). It looks only at over-commitment, so linking bills a transfer ALREADY paid (reconciliation)
--    stays possible before the transfer is confirmed. An ordinary bank line (not sent to a company) is left to the TO guards.
CREATE OR REPLACE FUNCTION public.hub_party_transfer_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_txn uuid;
BEGIN
  -- the SAME lock every bank-line writer takes, taken BEFORE any bill lock (trigger name sorts first on purpose)
  IF TG_TABLE_NAME = 'wire_package_lines' THEN SELECT w.funding_txn_id INTO v_txn FROM public.wire_packages w WHERE w.id = NEW.package_id;
  ELSIF TG_TABLE_NAME = 'wire_packages' THEN v_txn := NEW.funding_txn_id;
  ELSE v_txn := coalesce(NEW.source_bank_transaction_id, NEW.bank_transaction_id);
  END IF;
  IF v_txn IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_txn::text, 0)); END IF;
  RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION public.hub_party_transfer_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_ids uuid[]; v_txn uuid; s jsonb;
BEGIN
  IF TG_TABLE_NAME = 'vendor_bill_payments' THEN v_ids := ARRAY[NEW.bank_transaction_id];
  ELSIF TG_TABLE_NAME = 'party_money_entries' THEN v_ids := ARRAY[coalesce(NEW.source_bank_transaction_id, NEW.bank_transaction_id)];
  ELSIF TG_TABLE_NAME = 'wire_packages' THEN v_ids := ARRAY[NEW.funding_txn_id, NEW.bank_transaction_id];
  ELSE v_ids := ARRAY[(SELECT w.funding_txn_id FROM public.wire_packages w WHERE w.id = NEW.package_id)];
  END IF;
  FOREACH v_txn IN ARRAY v_ids LOOP
    CONTINUE WHEN v_txn IS NULL;
    s := public.hub_party_transfer_state(v_txn, NULL);
    CONTINUE WHEN (s->>'found')::boolean IS NOT TRUE OR s->>'party' IS NULL;
    IF (s->>'held')::numeric - (s->>'reserved')::numeric < -0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: this would use more than the $% transfer to % holds: already to bills $%, fees $%, reserved for requests $% — over by $%. Nothing was changed.',
        to_char((s->>'amount')::numeric, 'FM999,999,990.00'), s->>'party', to_char((s->>'bills')::numeric, 'FM999,999,990.00'), to_char((s->>'fees')::numeric, 'FM999,999,990.00'),
        to_char((s->>'reserved')::numeric, 'FM999,999,990.00'), to_char((s->>'reserved')::numeric - (s->>'held')::numeric, 'FM999,999,990.00');
    END IF;
  END LOOP;
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS hub_a_transfer_lock ON public.wire_package_lines;
CREATE TRIGGER hub_a_transfer_lock BEFORE INSERT OR UPDATE ON public.wire_package_lines FOR EACH ROW EXECUTE FUNCTION public.hub_party_transfer_lock();
DROP TRIGGER IF EXISTS hub_a_transfer_lock ON public.wire_packages;
CREATE TRIGGER hub_a_transfer_lock BEFORE INSERT OR UPDATE ON public.wire_packages FOR EACH ROW EXECUTE FUNCTION public.hub_party_transfer_lock();
DROP TRIGGER IF EXISTS hub_a_transfer_lock ON public.party_money_entries;
CREATE TRIGGER hub_a_transfer_lock BEFORE INSERT ON public.party_money_entries FOR EACH ROW EXECUTE FUNCTION public.hub_party_transfer_lock();
DROP TRIGGER IF EXISTS hub_party_transfer_guard ON public.vendor_bill_payments;
CREATE CONSTRAINT TRIGGER hub_party_transfer_guard AFTER INSERT OR UPDATE ON public.vendor_bill_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_party_transfer_guard();
DROP TRIGGER IF EXISTS hub_party_transfer_guard ON public.party_money_entries;
CREATE CONSTRAINT TRIGGER hub_party_transfer_guard AFTER INSERT ON public.party_money_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_party_transfer_guard();
DROP TRIGGER IF EXISTS hub_party_transfer_guard ON public.wire_packages;
CREATE CONSTRAINT TRIGGER hub_party_transfer_guard AFTER INSERT OR UPDATE ON public.wire_packages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_party_transfer_guard();
DROP TRIGGER IF EXISTS hub_party_transfer_guard ON public.wire_package_lines;
CREATE CONSTRAINT TRIGGER hub_party_transfer_guard AFTER INSERT OR UPDATE ON public.wire_package_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_party_transfer_guard();

-- 6. what a NEW ledger entry may be (old rows are untouched and still counted)
CREATE OR REPLACE FUNCTION public.hub_party_entry_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE f record; undone numeric;
BEGIN
  IF NEW.kind IN ('advance_to_fee', 'fee_to_advance', 'apply_to_bill') OR (NEW.kind = 'payment_split' AND NEW.bucket = 'advance') THEN
    RAISE EXCEPTION 'HUB_GUARD: this kind of advance entry is no longer used. Money sent to % that is not used yet is simply still held on its transfer — use it on a bill from "Use funds already with %", or mark services rendered on the transfer.', NEW.party, NEW.party;
  END IF;
  IF NEW.kind IN ('fee_from_transfer', 'fee_back_to_transfer', 'refund') AND NEW.source_bank_transaction_id IS NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: say which transfer this belongs to.';
  END IF;
  IF NEW.kind = 'fee_from_transfer' AND (NEW.bucket <> 'fee' OR NEW.amount <= 0) THEN RAISE EXCEPTION 'HUB_GUARD: a services-rendered fee is a positive amount.'; END IF;
  IF NEW.kind = 'refund' AND (NEW.bucket <> 'refund' OR NEW.amount <= 0) THEN RAISE EXCEPTION 'HUB_GUARD: a refund is a positive amount.'; END IF;
  IF NEW.kind = 'fee_back_to_transfer' THEN
    IF NEW.bucket <> 'fee' OR NEW.amount >= 0 OR NEW.corrects_id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a reversal must name the fee it reverses.'; END IF;
    SELECT e.id, e.amount, e.party, e.kind, e.source_bank_transaction_id INTO f FROM public.party_money_entries e WHERE e.id = NEW.corrects_id;
    IF f.id IS NULL OR f.kind <> 'fee_from_transfer' OR f.source_bank_transaction_id IS DISTINCT FROM NEW.source_bank_transaction_id OR lower(f.party) <> lower(NEW.party) THEN
      RAISE EXCEPTION 'HUB_GUARD: that is not a services-rendered fee of this transfer.';
    END IF;
    SELECT coalesce(sum(-e.amount), 0) INTO undone FROM public.party_money_entries e WHERE e.corrects_id = f.id AND e.kind = 'fee_back_to_transfer';
    IF round(-NEW.amount, 2) > round(f.amount - undone, 2) + 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: only $% of that fee is left to reverse.', to_char(greatest(f.amount - undone, 0), 'FM999,999,990.00');
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS hub_b_entry_rules ON public.party_money_entries;
CREATE TRIGGER hub_b_entry_rules BEFORE INSERT ON public.party_money_entries FOR EACH ROW EXECUTE FUNCTION public.hub_party_entry_rules();

-- 7. confirm a transfer as funds held by the company (or put it back to "needs reconciliation"). The Hub server checks who.
CREATE OR REPLACE FUNCTION public.hub_party_transfer_set_state(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_txn uuid := nullif(p->>'bank_transaction_id', '')::uuid; v_actor uuid := nullif(p->>'actor', '')::uuid; v_state text := p->>'state';
  v_party text := nullif(trim(coalesce(p->>'party', '')), ''); v_note text := nullif(left(trim(coalesce(p->>'note', '')), 300), ''); t record; v_old text; s jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_txn IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the transfer.'; END IF;
  IF v_state NOT IN ('confirmed', 'needs_reconciliation') THEN RAISE EXCEPTION 'HUB_GUARD: confirmed or needs reconciliation.'; END IF;
  IF v_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties x WHERE x.name = v_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_txn::text, 0));
  SELECT b.id, b.direction, b.pending, b.review_status, b.third_party_payer INTO t FROM public.bank_transactions b WHERE b.id = v_txn FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the transfer was not found.'; END IF;
  IF coalesce(t.direction, '') <> 'out' THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is money in.'; END IF;
  IF t.pending IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: that transfer is still pending at the bank.'; END IF;
  IF coalesce(t.review_status, '') = 'duplicate' THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is marked a duplicate copy.'; END IF;
  IF lower(trim(coalesce(t.third_party_payer, ''))) <> lower(v_party) THEN RAISE EXCEPTION 'HUB_GUARD: that transfer is not marked as sent to %. Mark it first (All Transactions).', v_party; END IF;
  SELECT f.state INTO v_old FROM public.party_funding_transfers f WHERE f.bank_transaction_id = v_txn;
  s := public.hub_party_transfer_state(v_txn, NULL);
  IF v_state = 'confirmed' AND (s->>'held')::numeric - (s->>'reserved')::numeric < -0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: more is recorded against this transfer than it sent — fix that first.';
  END IF;
  INSERT INTO public.party_funding_transfers (bank_transaction_id, party, state, note, updated_by, updated_at) VALUES (v_txn, v_party, v_state, v_note, v_actor, now())
  ON CONFLICT (bank_transaction_id) DO UPDATE SET party = EXCLUDED.party, state = EXCLUDED.state, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'party_transfer_state', 'bank_transaction', v_txn::text,
    jsonb_build_object('party', v_party, 'from', coalesce(v_old, 'needs_reconciliation'), 'to', v_state, 'note', v_note, 'state_before', s));
  RETURN jsonb_build_object('ok', true, 'from', coalesce(v_old, 'needs_reconciliation'), 'to', v_state, 'state', public.hub_party_transfer_state(v_txn, NULL));
END $fn$;

-- 8. SERVICES RENDERED on a transfer, and its reversal. One click id = one result. No payment is created.
--    p: { action: 'mark' | 'reverse', party, bank_transaction_id, amount, entry_date, reason, fee_id (reverse), actor, request_id, allow_closed }
CREATE OR REPLACE FUNCTION public.hub_party_fee(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_action text := p->>'action'; v_party text := nullif(trim(coalesce(p->>'party', '')), ''); v_txn uuid := nullif(p->>'bank_transaction_id', '')::uuid;
  v_amt numeric := round(coalesce((p->>'amount')::numeric, 0), 2); v_date date := coalesce(nullif(p->>'entry_date', '')::date, (now() AT TIME ZONE 'America/New_York')::date);
  v_reason text := nullif(left(trim(coalesce(p->>'reason', '')), 300), ''); v_fee uuid := nullif(p->>'fee_id', '')::uuid; v_actor uuid := nullif(p->>'actor', '')::uuid;
  v_req text := nullif(p->>'request_id', ''); v_closed_ok boolean := coalesce((p->>'allow_closed')::boolean, false);
  v_fp text; v_old record; t record; s jsonb; lock_through date; v_id uuid; v_action_id uuid := gen_random_uuid(); v_priv boolean := true; v_res jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_action NOT IN ('mark', 'reverse') THEN RAISE EXCEPTION 'HUB_GUARD: mark or reverse.'; END IF;
  IF v_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties x WHERE x.name = v_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company.'; END IF;
  IF v_txn IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the transfer.'; END IF;
  IF v_req IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: missing click id — refresh and try again.'; END IF;
  IF v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type an amount above zero.'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: say why (a short reason).'; END IF;
  IF v_date > (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'HUB_GUARD: the date cannot be in the future.'; END IF;
  IF v_action = 'reverse' AND v_fee IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the fee to reverse.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || v_party, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_txn::text, 0));
  v_fp := md5(concat_ws('|', v_action, lower(v_party), v_txn::text, v_amt::text, v_date::text, coalesce(v_fee::text, ''), v_reason));
  SELECT r.request_id, r.action, r.fingerprint, r.result INTO v_old FROM public.hub_party_requests r WHERE r.request_id = v_req;
  IF v_old.request_id IS NOT NULL THEN
    IF v_old.fingerprint = v_fp THEN RETURN v_old.result || jsonb_build_object('repeat', true); END IF;
    RAISE EXCEPTION 'HUB_GUARD: that click was already used for something else — refresh and try again.';
  END IF;

  SELECT b.id, b.direction, b.pending, b.review_status, b.third_party_payer, b.account_id INTO t FROM public.bank_transactions b WHERE b.id = v_txn FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the transfer was not found.'; END IF;
  IF lower(trim(coalesce(t.third_party_payer, ''))) <> lower(v_party) THEN RAISE EXCEPTION 'HUB_GUARD: that transfer is not marked as sent to %.', v_party; END IF;
  IF t.pending IS TRUE OR coalesce(t.review_status, '') = 'duplicate' THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is pending or a duplicate copy.'; END IF;
  -- a closed month stays closed unless the Hub server says this person may correct closed months
  IF to_regclass('clickbooks_us.books') IS NOT NULL AND NOT v_closed_ok THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO lock_through;
    IF lock_through IS NOT NULL AND v_date <= lock_through THEN
      RAISE EXCEPTION 'HUB_GUARD: % is inside a closed month (books are closed through %). Only a person allowed to correct closed months can date it there.', v_date, lock_through;
    END IF;
  END IF;
  -- an entry about a private bank account is private (unknown = private)
  BEGIN EXECUTE 'select coalesce(a.is_private, false) from public.plaid_accounts a where a.plaid_account_id = $1' INTO v_priv USING t.account_id; EXCEPTION WHEN others THEN v_priv := true; END;
  v_priv := coalesce(v_priv, false);

  s := public.hub_party_transfer_state(v_txn, NULL);
  IF v_action = 'mark' THEN
    IF s->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'HUB_GUARD: this transfer is not confirmed as funds held by % yet — confirm it first.', v_party; END IF;
    IF v_amt > (s->>'available')::numeric + 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: only $% of this transfer is free (to bills $%, fees $%, reserved $%). Release a reservation or reverse an allocation first.',
        to_char(greatest((s->>'available')::numeric, 0), 'FM999,999,990.00'), to_char((s->>'bills')::numeric, 'FM999,999,990.00'), to_char((s->>'fees')::numeric, 'FM999,999,990.00'), to_char((s->>'reserved')::numeric, 'FM999,999,990.00');
    END IF;
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, source_bank_transaction_id, action_id, entry_date, reason, request_id, created_by, is_private)
    VALUES (v_party, 'fee', v_amt, 'fee_from_transfer', v_txn, v_action_id, v_date, v_reason, v_req, v_actor, v_priv) RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, source_bank_transaction_id, corrects_id, action_id, entry_date, reason, request_id, created_by, is_private)
    VALUES (v_party, 'fee', -v_amt, 'fee_back_to_transfer', v_txn, v_fee, v_action_id, v_date, v_reason, v_req, v_actor, v_priv) RETURNING id INTO v_id; -- the entry rules cap it by its own fee
  END IF;
  v_res := jsonb_build_object('ok', true, 'action', v_action, 'entry_id', v_id, 'amount', v_amt, 'entry_date', v_date, 'state', public.hub_party_transfer_state(v_txn, NULL));
  INSERT INTO public.hub_party_requests (request_id, action, party, fingerprint, result, created_by) VALUES (v_req, 'fee_' || v_action, v_party, v_fp, v_res, v_actor);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, CASE WHEN v_action = 'mark' THEN 'party_services_rendered' ELSE 'party_services_reversed' END,
    'bank_transaction', v_txn::text, jsonb_build_object('party', v_party, 'amount', v_amt, 'entry_date', v_date, 'reason', v_reason, 'fee_id', v_fee, 'entry_id', v_id, 'closed_month_allowed', v_closed_ok, 'before', s));
  RETURN v_res;
END $fn$;

REVOKE ALL ON FUNCTION public.hub_party_transfer_state(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wire_funding_summary(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wire_request_send(uuid, uuid, date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_transfer_set_state(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_fee(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_transfer_lock() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_transfer_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_entry_rules() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_party_transfer_state(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.wire_funding_summary(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.wire_request_send(uuid, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_party_transfer_set_state(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_party_fee(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.hub_party_funds_installed() RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_party_transfer_state')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_party_fee')
     AND to_regclass('public.party_funding_transfers') IS NOT NULL
     AND (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'hub_party_transfer_guard' AND t.tgenabled <> 'D') = 4;
$fn$;
REVOKE ALL ON FUNCTION public.hub_party_funds_installed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hub_party_funds_installed() TO service_role;

-- CHECK (read-only): every line must say OK
SELECT 'one calculation of what a transfer holds' AS check_item, CASE WHEN position('hub_party_transfer_state' in pg_get_functiondef('public.wire_funding_summary(uuid,uuid)'::regprocedure)) > 0 THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'no writer can take a transfer below zero (4 guards on)', CASE WHEN public.hub_party_funds_installed() THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'a request leaves its own reservation out when it is sent', CASE WHEN position('wire_funding_summary(w.funding_txn_id, w.id)' in pg_get_functiondef('public.wire_request_send(uuid,uuid,date)'::regprocedure)) > 0 THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'old advance moves are retired for new entries', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'hub_b_entry_rules' AND t.tgenabled <> 'D') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'only the Hub server can mark services rendered or confirm a transfer', CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_party_fee(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hub_party_transfer_set_state(jsonb)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.hub_party_fee(jsonb)', 'EXECUTE') THEN 'OK' ELSE 'PROBLEM' END;
