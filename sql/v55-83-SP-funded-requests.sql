-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- v55.83-SP — PAYMENT REQUESTS DRAWN FROM A TRANSFER (RTM Capital / NextTrade)
-- Max, Nov 15 2026 (approved plan, part one):
--   "sometimes we transfer money up front to RTM or next trade ... then we send them the associated bills,
--    and then they send it based on a request."
--   "A bank line needs to serve two wires if necessary, especially in the past."
--   "they should not go beyond the amount you transfer to Nextrade or RTM, and take into account their
--    professional fees ... Even if you have to split or partially pay a bill."
--   "Past requests also need to have confirmations with two signatures."
--   Service fee change: "Doesn't need double signatures."
--
-- WHAT THIS ADDS (nothing existing is removed; a wire sent from our own bank works exactly as before):
--   • wire_packages.funding_txn_id — the transfer (bank line) a request draws from. NULL = an ordinary wire.
--   • wire_packages.planned_send_date — a label only; it never changes a status.
--   • ONE bank line may carry SEVERAL requests — but only requests (funding_txn_id set). An ordinary wire
--     still owns its bank line alone.
--   • wire_request_send(): in ONE step, under a lock on the transfer: checks the request fits what is left
--     on the transfer, records each bill's payment against that bank line (dated the day the money left —
--     the same rule as every other wire), and marks the request attached. All or nothing.
--   • wire_request_fee_change(): the service fee of a sent request may change (with a reason, audited by
--     the Hub) as long as the transfer still has room. No new signatures.
-- Booking is unchanged: the transfer stays ONE professional-fees line; the bills are its breakdown.
-- Run AFTER the RZ file. SAFE TO RE-RUN. Deletes nothing.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS funding_txn_id uuid;
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS planned_send_date date;
CREATE INDEX IF NOT EXISTS idx_wpkg_funding ON public.wire_packages (funding_txn_id) WHERE funding_txn_id IS NOT NULL;

-- A request is always to a paid-through company, never straight to a vendor; once attached it sits on its own transfer.
ALTER TABLE public.wire_packages DROP CONSTRAINT IF EXISTS wpkg_funded_not_vendor;
ALTER TABLE public.wire_packages ADD CONSTRAINT wpkg_funded_not_vendor CHECK (funding_txn_id IS NULL OR payee_kind <> 'vendor');
ALTER TABLE public.wire_packages DROP CONSTRAINT IF EXISTS wpkg_funded_same_line;
ALTER TABLE public.wire_packages ADD CONSTRAINT wpkg_funded_same_line CHECK (funding_txn_id IS NULL OR bank_transaction_id IS NULL OR bank_transaction_id = funding_txn_id);

-- "One bank line, one wire" now applies to ordinary wires only. Requests may share their transfer.
DO $sp$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.wire_packages'::regclass AND contype = 'u'
              AND pg_get_constraintdef(oid) ILIKE '%(bank_transaction_id)%'
  LOOP EXECUTE format('ALTER TABLE public.wire_packages DROP CONSTRAINT %I', c); END LOOP;
END $sp$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wpkg_bank_line_exclusive ON public.wire_packages (bank_transaction_id)
  WHERE funding_txn_id IS NULL AND bank_transaction_id IS NOT NULL;

-- Locks: the same as before (RZ), plus — the transfer a request draws from cannot change once it is sent,
-- and the SERVICE FEE of a sent request may change only through wire_request_fee_change().
CREATE OR REPLACE FUNCTION public.wpkg_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE fee_ok boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: only a draft package can be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('cancelled', 'reversed') THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a % package cannot change', OLD.status; END IF;
  IF OLD.status IN ('sent', 'attached') THEN
    fee_ok := OLD.funding_txn_id IS NOT NULL AND coalesce(current_setting('ktc.wire_fee_change', true), '') = '1';
    IF NEW.funding_txn_id IS DISTINCT FROM OLD.funding_txn_id THEN
      RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: the transfer a sent request draws from cannot change';
    END IF;
    IF NEW.payee_name IS DISTINCT FROM OLD.payee_name OR NEW.payee_kind IS DISTINCT FROM OLD.payee_kind
       OR (NOT fee_ok AND (NEW.fee_amount IS DISTINCT FROM OLD.fee_amount OR NEW.approved_total IS DISTINCT FROM OLD.approved_total))
       OR NEW.check_hash IS DISTINCT FROM OLD.check_hash OR NEW.check_pass IS DISTINCT FROM OLD.check_pass
       OR NEW.signoff1_by IS DISTINCT FROM OLD.signoff1_by OR NEW.signoff2_by IS DISTINCT FROM OLD.signoff2_by
       OR NEW.signoff1_hash IS DISTINCT FROM OLD.signoff1_hash OR NEW.signoff2_hash IS DISTINCT FROM OLD.signoff2_hash
       OR NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.bank_reference IS DISTINCT FROM OLD.bank_reference
       OR NEW.after_the_fact IS DISTINCT FROM OLD.after_the_fact OR NEW.after_the_fact_note IS DISTINCT FROM OLD.after_the_fact_note THEN
      RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a sent wire cannot be changed';
    END IF;
    IF NEW.sent_date IS DISTINCT FROM OLD.sent_date AND OLD.status <> 'sent' THEN
      RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: the sent date can only be corrected before the bank line is attached';
    END IF;
    IF NEW.status = 'reversed' THEN RETURN NEW; END IF;
    IF NEW.status NOT IN ('sent', 'attached') THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a sent wire cannot be cancelled — it can only be reversed (with a reason)'; END IF;
    IF OLD.status = 'attached' AND (NEW.bank_transaction_id IS DISTINCT FROM OLD.bank_transaction_id OR NEW.bank_fee IS DISTINCT FROM OLD.bank_fee) THEN
      RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: the bank line of an attached wire cannot change';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- How much of a transfer is already used: every bill payment recorded against that bank line, plus the
-- service fees of the requests attached to it. p_except leaves one request out (to ask "what if this one changes").
CREATE OR REPLACE FUNCTION public.wire_funding_summary(p_txn uuid, p_except uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE amt numeric; pays numeric; fees numeric; reqs int;
BEGIN
  SELECT round(abs(coalesce(t.amount_abs, 0)), 2) INTO amt FROM public.bank_transactions t WHERE t.id = p_txn;
  IF amt IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT coalesce(sum(round(p.amount, 2)), 0) INTO pays
    FROM public.vendor_bill_payments p
   WHERE p.bank_transaction_id = p_txn AND p.voided IS NOT TRUE
     AND (p_except IS NULL OR NOT EXISTS (SELECT 1 FROM public.wire_package_lines l WHERE l.payment_id = p.id AND l.package_id = p_except));
  SELECT coalesce(sum(round(w.fee_amount, 2)), 0), count(*) INTO fees, reqs
    FROM public.wire_packages w
   WHERE w.bank_transaction_id = p_txn AND w.status = 'attached' AND (p_except IS NULL OR w.id <> p_except);
  RETURN jsonb_build_object('found', true, 'amount', amt, 'bills', pays, 'fees', fees, 'used', pays + fees,
                            'remaining', amt - pays - fees, 'requests', reqs);
END $fn$;

-- Send a request: everything in one transaction, under a lock on the transfer.
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
  s := public.wire_funding_summary(w.funding_txn_id, NULL);
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

-- Change the service fee of a request that was already sent. No new signatures; the Hub records who and why.
CREATE OR REPLACE FUNCTION public.wire_request_fee_change(p_pkg uuid, p_fee numeric, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE w public.wire_packages%ROWTYPE; tj jsonb; t_date date; s jsonb; bills numeric; new_fee numeric; lock_through date;
BEGIN
  SELECT * INTO w FROM public.wire_packages WHERE id = p_pkg FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'why', 'Request not found.'); END IF;
  IF w.funding_txn_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'Only a request drawn from a transfer has a service fee that can change after it is sent.'); END IF;
  IF w.status <> 'attached' THEN RETURN jsonb_build_object('ok', false, 'why', 'Before a request is sent, change the fee by editing the request.'); END IF;
  new_fee := round(coalesce(p_fee, -1), 2);
  IF new_fee < 0 THEN RETURN jsonb_build_object('ok', false, 'why', 'The service fee cannot be negative.'); END IF;
  -- v55.83-VA (Codex 06:18) — the same order as every other writer on a bank line: its advisory lock FIRST, then its row
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || w.funding_txn_id::text, 0));
  SELECT to_jsonb(t) INTO tj FROM public.bank_transactions t WHERE t.id = w.funding_txn_id FOR UPDATE;
  IF tj IS NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'The transfer is no longer in the books.'); END IF;
  t_date := coalesce(nullif(tj->>'posted_date', '')::date, nullif(tj->>'date', '')::date);
  IF to_regclass('clickbooks_us.books') IS NOT NULL AND t_date IS NOT NULL THEN
    EXECUTE 'select locked_through from clickbooks_us.books where code = ''KTC_US''' INTO lock_through;
    IF lock_through IS NOT NULL AND t_date <= lock_through THEN
      RETURN jsonb_build_object('ok', false, 'why', 'The transfer is inside a closed month (closed through ' || lock_through || '). Reopen the month first.', 'blocked_by', 'closed month');
    END IF;
  END IF;
  SELECT coalesce(sum(round(l.amount, 2)), 0) INTO bills FROM public.wire_package_lines l WHERE l.package_id = w.id;
  s := public.wire_funding_summary(w.funding_txn_id, w.id);
  IF bills + new_fee > (s->>'remaining')::numeric + 0.005 THEN
    RETURN jsonb_build_object('ok', false, 'why', 'A fee of $' || to_char(new_fee, 'FM999,999,990.00') || ' does not fit: only $' || to_char(greatest((s->>'remaining')::numeric - bills, 0), 'FM999,999,990.00') || ' of the transfer is free for it.', 'blocked_by', 'over the transfer',
                              'max_fee', greatest((s->>'remaining')::numeric - bills, 0));
  END IF;
  PERFORM set_config('ktc.wire_fee_change', '1', true);
  UPDATE public.wire_packages SET fee_amount = new_fee, approved_total = bills + new_fee, updated_at = now() WHERE id = w.id;
  PERFORM set_config('ktc.wire_fee_change', '', true);
  RETURN jsonb_build_object('ok', true, 'from', round(coalesce(w.fee_amount, 0), 2), 'to', new_fee, 'total', bills + new_fee,
                            'remaining_after', (s->>'remaining')::numeric - bills - new_fee);
END $fn$;

REVOKE ALL ON FUNCTION public.wire_funding_summary(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wire_request_send(uuid, uuid, date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wire_request_fee_change(uuid, numeric, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wire_funding_summary(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.wire_request_send(uuid, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.wire_request_fee_change(uuid, numeric, uuid) TO service_role;

SELECT 'SP funded requests installed' AS result,
       (SELECT count(*) FROM public.wire_packages WHERE funding_txn_id IS NOT NULL) AS requests_on_transfers;
