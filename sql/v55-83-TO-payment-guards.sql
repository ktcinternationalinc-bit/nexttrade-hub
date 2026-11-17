-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TO — PAYMENT GUARDS (Codex QA 16 Nov, P1 release blockers; Max approved "Codex first", Nov 17 2026)
-- One lock contract for EVERY writer of bill payments and order deposit links: the database itself refuses a payment that would
-- spend more than a bank line holds, or pay a bill beyond its total — even when two people click at the same moment, and whatever
-- screen or route wrote it. Adds columns + guard functions + triggers only. Nothing existing is changed or deleted. Safe to run
-- more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. one id per click, so a retry after a lost answer never pays twice
ALTER TABLE public.vendor_bill_payments ADD COLUMN IF NOT EXISTS request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS vendor_bill_payments_request ON public.vendor_bill_payments (request_id, bill_id) WHERE request_id IS NOT NULL;

-- 2. the guard for bill payments: lock the bank line, then the bill; re-add everything under the lock; refuse an over-allocation
CREATE OR REPLACE FUNCTION public.hub_guard_bill_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_bank_amt numeric; v_bank_used numeric; v_bill_total numeric; v_bill_paid numeric;
BEGIN
  IF NEW.voided IS TRUE THEN RETURN NULL; END IF; -- undoing a payment is always allowed
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
  IF v_bill_paid > coalesce(v_bill_total, 0) + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: the bill total is %; payments on it would come to % — over by %.', round(coalesce(v_bill_total, 0), 2), round(v_bill_paid, 2), round(v_bill_paid - coalesce(v_bill_total, 0), 2);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS hub_guard_bill_payment ON public.vendor_bill_payments;
CREATE TRIGGER hub_guard_bill_payment AFTER INSERT OR UPDATE OF amount, voided, bill_id, bank_transaction_id
  ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.hub_guard_bill_payment();

-- 3. the same guard for a deposit matched to a warehouse order (TI): deposit links + customer invoice payments on one bank line
--    may never add up to more than the bank line
ALTER TABLE public.order_deposit_links ADD COLUMN IF NOT EXISTS request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS order_deposit_links_request ON public.order_deposit_links (request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.hub_guard_deposit_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_amt numeric; v_links numeric; v_inv numeric;
BEGIN
  IF NEW.voided IS TRUE THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || NEW.bank_transaction_id::text, 0));
  SELECT amount_abs INTO v_amt FROM public.bank_transactions WHERE id = NEW.bank_transaction_id;
  IF v_amt IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank transaction was not found.'; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_links FROM public.order_deposit_links WHERE bank_transaction_id = NEW.bank_transaction_id AND voided IS NOT TRUE;
  SELECT coalesce(sum(amount), 0) INTO v_inv FROM public.accounting_invoice_payments WHERE bank_transaction_id = NEW.bank_transaction_id AND voided IS NOT TRUE;
  IF v_links + v_inv > v_amt + 0.005 THEN
    RAISE EXCEPTION 'HUB_GUARD: that bank line is %; deposits and invoice payments matched to it would come to % — over by %.', round(v_amt, 2), round(v_links + v_inv, 2), round(v_links + v_inv - v_amt, 2);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS hub_guard_deposit_link ON public.order_deposit_links;
CREATE TRIGGER hub_guard_deposit_link AFTER INSERT OR UPDATE OF amount, voided, bank_transaction_id
  ON public.order_deposit_links FOR EACH ROW EXECUTE FUNCTION public.hub_guard_deposit_link();

-- 4. order closures: the intent is written FIRST (pending), then Nextrade is asked, then it is marked done or failed
ALTER TABLE public.order_closures ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'succeeded';
ALTER TABLE public.order_closures ADD COLUMN IF NOT EXISTS request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS order_closures_request ON public.order_closures (request_id) WHERE request_id IS NOT NULL;

-- 5. 30-hour alerts: an alert is CLAIMED before it is emailed, so two overlapping checks can never send it twice
ALTER TABLE public.order_alerts ADD COLUMN IF NOT EXISTS sending_at timestamptz;

-- 6. the Hub asks this to know the guards are in place (the payment buttons stay off until they are)
CREATE OR REPLACE FUNCTION public.hub_payment_guards_installed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_guard_bill_payment' AND NOT tgisinternal)
     AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_guard_deposit_link' AND NOT tgisinternal);
$$;
REVOKE ALL ON FUNCTION public.hub_payment_guards_installed() FROM anon;

-- proof: should return one row saying true
SELECT public.hub_payment_guards_installed() AS guards_installed;
