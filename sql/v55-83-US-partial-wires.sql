-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-US — partial wires (Max, 19 Nov 2026: "i partially wired a bill. the bill should remain in queue with the remaining
-- amount to be used on another wire. its simple")
--   Before: one bill could be on only ONE open wire (unique index uq_wpkg_line_open_bill), so the rest of a partly wired bill
--   could not go on a second wire until the first was fully closed.
--   Now: a bill may be on several open wires, as long as   paid so far + every open wire amount  ≤  the bill total.
--   And a bill can never be paid more than its total, whichever way the payment is recorded.
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

-- 2. a bill is never paid more than its total (the wire's own line is closed right after its payment is recorded,
--    so open wire amounts are NOT counted here — only payments)
CREATE OR REPLACE FUNCTION public.hub_bill_payment_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric; v_paid numeric;
BEGIN
  IF NEW.voided IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.voided IS NOT TRUE AND round(NEW.amount, 2) <= round(OLD.amount, 2) AND NEW.bill_id = OLD.bill_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || NEW.bill_id::text, 0));
  SELECT round(coalesce(total_amount, 0), 2) INTO v_total FROM public.vendor_bills WHERE id = NEW.bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_GUARD: the bill for this payment was not found.'; END IF;
  SELECT coalesce(sum(round(amount, 2)), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = NEW.bill_id AND voided IS NOT TRUE AND id IS DISTINCT FROM NEW.id;
  IF v_paid + round(NEW.amount, 2) > v_total + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: this payment of $% would pay the bill more than its total (total $%, already paid $%).',
      to_char(round(NEW.amount, 2), 'FM999,999,990.00'), to_char(v_total, 'FM999,999,990.00'), to_char(v_paid, 'FM999,999,990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_payment_cap() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS hub_wire_line_cap ON public.wire_package_lines;
CREATE TRIGGER hub_wire_line_cap BEFORE INSERT OR UPDATE ON public.wire_package_lines FOR EACH ROW EXECUTE FUNCTION public.hub_wire_line_cap();
DROP TRIGGER IF EXISTS hub_bill_payment_cap ON public.vendor_bill_payments;
CREATE TRIGGER hub_bill_payment_cap BEFORE INSERT OR UPDATE ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.hub_bill_payment_cap();

-- 3. the old "one bill, one open wire" rule goes (the cap above replaces it)
DROP INDEX IF EXISTS public.uq_wpkg_line_open_bill;

-- CHECK (read-only): every line must say OK
SELECT 'a bill may now be on more than one open wire' AS check_item,
       CASE WHEN to_regclass('public.uq_wpkg_line_open_bill') IS NULL THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'wire lines can never reserve more than is left on a bill',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_wire_line_cap' AND tgrelid = 'public.wire_package_lines'::regclass) THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'a bill can never be paid more than its total',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_payment_cap' AND tgrelid = 'public.vendor_bill_payments'::regclass) THEN 'OK' ELSE 'PROBLEM' END;
