-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-US — partial wires (Max, 19 Nov 2026: "i partially wired a bill. the bill should remain in queue with the remaining
-- amount to be used on another wire. its simple")
--   Before: one bill could be on only ONE open wire (unique index uq_wpkg_line_open_bill), so the rest of a partly wired bill
--   could not go on a second wire until the first was fully closed.
--   Now: a bill may be on several open wires, as long as   paid so far + every open wire amount  ≤  the bill total.
--   And a bill can never be paid more than its total, whichever way the payment is recorded — a payment must also leave
--   room for what OTHER open wires already hold. A void / deleted bill takes no new payment, and a bill with a payment that is
--   not undone (or on an open wire) cannot be voided or deleted.
--   Both are checked inside the database under the bill's own lock (the same lock the payment steps use), so two people
--   preparing wires for the same bill at the same moment cannot over-allocate it.
-- Changes no data. Safe to run more than once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. a wire line may only reserve what is still left on the bill
CREATE OR REPLACE FUNCTION public.hub_wire_line_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_status text; v_paid numeric; v_open numeric; v_left numeric;
BEGIN
  IF NEW.is_open IS NOT TRUE THEN RETURN NEW; END IF; -- closing / cancelling a line never needs the check
  IF TG_OP = 'UPDATE' AND OLD.is_open IS TRUE AND NEW.amount <= OLD.amount AND NEW.bill_id = OLD.bill_id THEN RETURN NEW; END IF; -- lowering is always fine
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2), record_status INTO v_total, v_status FROM public.vendor_bills WHERE id = NEW.bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill on this wire line was not found.'; END IF;
  IF v_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this bill is % — it cannot go on a wire.', coalesce(v_status, 'not active'); END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_open FROM public.wire_package_lines WHERE bill_id = NEW.bill_id AND is_open IS TRUE AND id IS DISTINCT FROM NEW.id;
  v_left := v_total - v_paid - v_open;
  IF round(NEW.amount, 2) > v_left + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: only $% is left on this bill (total $%, paid $%, on other open wires $%) — this wire line asks $%.',
      to_char(greatest(v_left, 0), 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00'), to_char(v_open, 'FM999,999,990.00'), to_char(round(NEW.amount, 2), 'FM999,999,990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_wire_line_cap() FROM public, anon, authenticated;

-- 2. EVERY payment, whoever records it (Codex 05:38 / 05:51). Two checks:
--    (a) at once: only on an ACTIVE bill, and live payments + this one ≤ the bill total;
--    (b) at the END of the transaction (a deferred check, NO exemptions): live payments + every wire line STILL open ≤ the bill total.
--    A wire pays its own line through public.hub_wire_line_pay (payment + closing that exact line in ONE transaction), so by the time
--    (b) runs its own reservation is closed; any other payment made while a wire still holds the money is refused — also one made
--    from the same bank transfer (one transfer can fund several requests: the bank line is not the wire's identity).
--    Locks: bank line first, then bill — the same order as the payment guards (sql/v55-83-TO-payment-guards.sql).
CREATE OR REPLACE FUNCTION public.hub_bill_payment_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_status text; v_paid numeric;
BEGIN
  IF NEW.voided IS TRUE THEN RETURN NEW; END IF; -- undoing a payment is always allowed
  IF TG_OP = 'UPDATE' AND OLD.voided IS NOT TRUE AND round(NEW.amount, 2) <= round(OLD.amount, 2) AND NEW.bill_id = OLD.bill_id THEN RETURN NEW; END IF;
  IF NEW.bank_transaction_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || NEW.bank_transaction_id::text, 0)); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2), record_status INTO v_total, v_status FROM public.vendor_bills WHERE id = NEW.bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill for this payment was not found.'; END IF;
  IF v_status IS NOT NULL AND v_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this bill is % — it cannot take a payment.', v_status; END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE AND id IS DISTINCT FROM NEW.id;
  IF v_paid + round(NEW.amount, 2) > v_total + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: this payment of $% would pay the bill more than its total (total $%, already paid $%).',
      to_char(round(NEW.amount, 2), 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_payment_cap() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hub_bill_payment_final() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_paid numeric; v_open numeric := 0; v_live boolean;
BEGIN
  SELECT (voided IS NOT TRUE) INTO v_live FROM public.vendor_bill_payments WHERE id = NEW.id;
  IF v_live IS NOT TRUE THEN RETURN NULL; END IF; -- undone (or gone) by the end of the transaction
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2) INTO v_total FROM public.vendor_bills WHERE id = NEW.bill_id;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE;
  IF to_regclass('public.wire_package_lines') IS NOT NULL THEN
    SELECT coalesce(sum(round(amount, 2)), 0) INTO v_open FROM public.wire_package_lines WHERE bill_id = NEW.bill_id AND is_open IS TRUE;
  END IF;
  IF v_paid + v_open > v_total + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: $% of this bill is held on an open wire — with this payment the bill would be at $% paid + $% held, more than its total of $%. Lower the payment, or change / cancel that wire first.',
      to_char(v_open, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00'), to_char(v_open, 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_payment_final() FROM public, anon, authenticated;

-- 2a. a wire pays ONE of its lines: the payment is recorded and THAT line is closed, together or not at all. Only the Hub server.
CREATE OR REPLACE FUNCTION public.hub_wire_line_pay(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_line uuid := (p->>'line_id')::uuid; v_bank uuid := nullif(p->>'bank_transaction_id', '')::uuid; l record; pid uuid;
BEGIN
  IF v_bank IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || v_bank::text, 0)); END IF;
  SELECT id, bill_id, amount, is_open INTO l FROM public.wire_package_lines WHERE id = v_line FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_line'); END IF;
  IF l.is_open IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'code', 'line_closed'); END IF;
  INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by)
  VALUES (l.bill_id, round(l.amount, 2), (p->>'paid_date')::date, v_bank, nullif(p->>'method', ''), nullif(p->>'actor', '')::uuid) RETURNING id INTO pid;
  UPDATE public.wire_package_lines SET is_open = false, payment_id = pid WHERE id = l.id;
  RETURN jsonb_build_object('ok', true, 'payment_id', pid, 'line_id', l.id);
END $$;
REVOKE ALL ON FUNCTION public.hub_wire_line_pay(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_wire_line_pay(jsonb) TO service_role;

-- 2b. a bill cannot be voided / deleted while it has a payment that is not undone, or sits on an open wire. Same bill lock as the
--     payment check above, so "void" and "pay" at the same moment can never both go through.
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
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_void_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS hub_wire_line_cap ON public.wire_package_lines;
CREATE TRIGGER hub_wire_line_cap BEFORE INSERT OR UPDATE ON public.wire_package_lines FOR EACH ROW EXECUTE FUNCTION public.hub_wire_line_cap();
DROP TRIGGER IF EXISTS hub_bill_payment_cap ON public.vendor_bill_payments;
CREATE TRIGGER hub_bill_payment_cap BEFORE INSERT OR UPDATE ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.hub_bill_payment_cap();
DROP TRIGGER IF EXISTS hub_bill_payment_final ON public.vendor_bill_payments;
CREATE CONSTRAINT TRIGGER hub_bill_payment_final AFTER INSERT OR UPDATE ON public.vendor_bill_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hub_bill_payment_final();
DROP TRIGGER IF EXISTS hub_bill_void_guard ON public.vendor_bills;
CREATE TRIGGER hub_bill_void_guard BEFORE UPDATE OF record_status ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.hub_bill_void_guard();

-- 3. the old "one bill, one open wire" rule goes (the cap above replaces it)
DROP INDEX IF EXISTS public.uq_wpkg_line_open_bill;

-- CHECK (read-only): every line must say OK
SELECT 'a bill may now be on more than one open wire' AS check_item,
       CASE WHEN to_regclass('public.uq_wpkg_line_open_bill') IS NULL THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'wire lines can never reserve more than is left on a bill',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_wire_line_cap' AND tgrelid = 'public.wire_package_lines'::regclass) THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'a bill with a payment or on an open wire cannot be voided or deleted',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_void_guard' AND tgrelid = 'public.vendor_bills'::regclass) THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'a payment can never use money an open wire holds (final check)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_payment_final' AND tgrelid = 'public.vendor_bill_payments'::regclass) AND has_function_privilege('service_role', 'public.hub_wire_line_pay(jsonb)', 'EXECUTE') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'a bill can never be paid more than its total',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_payment_cap' AND tgrelid = 'public.vendor_bill_payments'::regclass) THEN 'OK' ELSE 'PROBLEM' END;
