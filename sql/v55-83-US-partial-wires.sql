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

-- 2. EVERY payment, whoever records it (Codex 05:38 P1-4/5): live payments + this one + what OTHER open wires hold ≤ the bill total,
--    and only on an ACTIVE bill. "Other" = open wire lines except those of the wire this payment belongs to: a wire records its
--    payments with ITS bank line (wire_packages.bank_transaction_id, or the transfer it draws from, funding_txn_id) while its own
--    lines are still open, and closes them right after — so its own reservation must not count against its own payment.
CREATE OR REPLACE FUNCTION public.hub_bill_payment_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_status text; v_paid numeric; v_open numeric := 0;
BEGIN
  IF NEW.voided IS TRUE THEN RETURN NEW; END IF; -- undoing a payment is always allowed
  IF TG_OP = 'UPDATE' AND OLD.voided IS NOT TRUE AND round(NEW.amount, 2) <= round(OLD.amount, 2) AND NEW.bill_id = OLD.bill_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2), record_status INTO v_total, v_status FROM public.vendor_bills WHERE id = NEW.bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill for this payment was not found.'; END IF;
  IF v_status IS NOT NULL AND v_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: this bill is % — it cannot take a payment.', v_status; END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE AND id IS DISTINCT FROM NEW.id;
  IF to_regclass('public.wire_package_lines') IS NOT NULL AND to_regclass('public.wire_packages') IS NOT NULL THEN
    SELECT coalesce(sum(round(l.amount, 2)), 0) INTO v_open
    FROM public.wire_package_lines l LEFT JOIN public.wire_packages w ON w.id = l.package_id
    WHERE l.bill_id = NEW.bill_id AND l.is_open IS TRUE
      AND NOT (NEW.bank_transaction_id IS NOT NULL AND w.id IS NOT NULL
               AND NEW.bank_transaction_id::text IN (coalesce(to_jsonb(w)->>'bank_transaction_id', ''), coalesce(to_jsonb(w)->>'funding_txn_id', '')));
  END IF;
  IF v_paid + round(NEW.amount, 2) + v_open > v_total + 0.005 THEN
    IF v_open > 0.005 AND v_paid + round(NEW.amount, 2) <= v_total + 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: $% of this bill is held on an open wire — only $% can be paid now (total $%, already paid $%). Lower the payment, or change / cancel that wire first.',
        to_char(v_open, 'FM999,999,990.00'), to_char(greatest(v_total - v_paid - v_open, 0), 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00');
    END IF;
    RAISE EXCEPTION 'HUB_GUARD: this payment of $% would pay the bill more than its total (total $%, already paid $%).',
      to_char(round(NEW.amount, 2), 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_payment_cap() FROM public, anon, authenticated;

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
UNION ALL SELECT 'a bill can never be paid more than its total',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_payment_cap' AND tgrelid = 'public.vendor_bill_payments'::regclass) THEN 'OK' ELSE 'PROBLEM' END;
