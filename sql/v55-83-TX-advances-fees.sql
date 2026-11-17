-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TX — PAYING NEXTRADE / RTM: bills · extra professional fee · ADVANCE (Max, Nov 17 2026)
-- A payment KTC sends NextTrade or RTM can be split into the bills it covers (as today), an extra professional fee for
-- their services, and an ADVANCE (money held for later — an asset, never an expense). Later a person can:
--   • apply part of the advance to specific bills (they become paid by the advance), or
--   • turn part of the advance into a professional fee, or a fee back into advance — any amount, with who / when / why.
-- Every change is a NEW row in party_money_entries (append-only: rows can never be edited or deleted; the original is
-- never erased). The running advance balance and fee total per company can never go below zero: ONE database function
-- does every move under a lock (the same bank-line lock as the TO payment guards), so two people at once can never
-- overspend the advance. Needs sql/v55-83-TO-payment-guards.sql first. Adds a table + functions only. Safe to re-run.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.party_money_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party text NOT NULL,                                -- paid_through_parties.name (NextTrade Industries / RTM Capital)
  bucket text NOT NULL CHECK (bucket IN ('advance','fee')),
  amount numeric NOT NULL CHECK (amount <> 0),        -- + adds to the bucket, − takes from it
  kind text NOT NULL CHECK (kind IN ('payment_split','apply_to_bill','advance_to_fee','fee_to_advance')),
  bank_transaction_id uuid,                           -- payment_split: the KTC bank line (money out) it came from
  bill_id uuid REFERENCES public.vendor_bills(id),    -- apply_to_bill
  bill_payment_id uuid REFERENCES public.vendor_bill_payments(id),
  action_id uuid NOT NULL,                            -- the rows of one action share it
  entry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/New_York')::date,
  reason text,
  request_id text,                                    -- one per click: a retry never moves money twice
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS party_money_entries_request ON public.party_money_entries (request_id, bucket, kind) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS party_money_entries_party ON public.party_money_entries (party, bucket);
CREATE INDEX IF NOT EXISTS party_money_entries_line ON public.party_money_entries (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
ALTER TABLE public.party_money_entries ENABLE ROW LEVEL SECURITY;

-- append-only: an entry is never changed or removed (a mistake is corrected by a new, opposite entry)
CREATE OR REPLACE FUNCTION public.hub_party_money_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'HUB_GUARD: advance / fee entries are never changed or deleted — add a correcting entry instead.'; END $$;
DROP TRIGGER IF EXISTS party_money_entries_append_only ON public.party_money_entries;
CREATE TRIGGER party_money_entries_append_only BEFORE UPDATE OR DELETE ON public.party_money_entries
  FOR EACH ROW EXECUTE FUNCTION public.hub_party_money_append_only();

-- (Codex 17 Nov 19:50) does this company's advance pool hold ANY money a caller may not see? Over the COMPLETE ledger: a
-- split whose bank line is in one of p_hidden_accounts, or whose line is missing, or has no account → true (fails closed).
CREATE OR REPLACE FUNCTION public.hub_party_pool_restricted(p_party text, p_hidden_accounts text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.party_money_entries e LEFT JOIN public.bank_transactions b ON b.id = e.bank_transaction_id
    WHERE e.party = p_party AND e.bank_transaction_id IS NOT NULL
      AND (b.id IS NULL OR b.account_id IS NULL OR b.account_id = ANY (coalesce(p_hidden_accounts, ARRAY[]::text[]))));
$$;
-- Authoritative balances per company over the COMPLETE ledger (never a paged display list), plus whether the pool holds money
-- the caller may not see. The Hub shows a balance only when restricted = false (or the caller sees all private accounts).
CREATE OR REPLACE FUNCTION public.hub_party_pool_status(p_hidden_accounts text[])
RETURNS TABLE (party text, advance numeric, fee numeric, entries bigint, restricted boolean)
LANGUAGE sql STABLE AS $$
  SELECT e.party, round(coalesce(sum(e.amount) FILTER (WHERE e.bucket = 'advance'), 0), 2), round(coalesce(sum(e.amount) FILTER (WHERE e.bucket = 'fee'), 0), 2),
         count(*), public.hub_party_pool_restricted(e.party, p_hidden_accounts)
  FROM public.party_money_entries e GROUP BY e.party;
$$;

-- THE one way money moves between the buckets. Called only by the Hub server (service key), which has already checked
-- the signed-in person and the "advances.manage" permission.
-- p_action: 'split' (a bank line → fee + advance) · 'apply' (advance → pay one bill) · 'to_fee' · 'to_advance'
-- (Codex 17 Nov 19:50) the 9-argument first version is replaced by this one (same name + p_hidden_accounts); dropping the
-- old FUNCTION definition removes no data.
DROP FUNCTION IF EXISTS public.hub_party_money(text, text, numeric, numeric, uuid, uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.hub_party_money(p_action text, p_party text, p_amount numeric, p_fee numeric,
  p_bank_txn uuid, p_bill uuid, p_reason text, p_actor uuid, p_request_id text, p_hidden_accounts text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_action uuid := gen_random_uuid(); v_adv numeric; v_fee numeric; v_line record; v_line_used numeric; v_split numeric;
  v_bill record; v_pay uuid; v_amt numeric := round(coalesce(p_amount, 0), 2); v_fee_amt numeric := round(coalesce(p_fee, 0), 2);
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF p_party IS NULL OR NOT EXISTS (SELECT 1 FROM public.paid_through_parties WHERE name = p_party) THEN RAISE EXCEPTION 'HUB_GUARD: unknown company %.', p_party; END IF;
  -- one click id = one move. The same click arriving again (same company, same kind of move, same amounts, same line / bill)
  -- returns the first result; a click id re-used for a DIFFERENT move is refused (Codex QA 17 Nov: replay contract).
  IF p_request_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.party_money_entries WHERE request_id = p_request_id) THEN
    IF EXISTS (SELECT 1 FROM public.party_money_entries WHERE request_id = p_request_id AND (party <> p_party
         OR kind <> CASE p_action WHEN 'split' THEN 'payment_split' WHEN 'apply' THEN 'apply_to_bill' WHEN 'to_fee' THEN 'advance_to_fee' WHEN 'to_advance' THEN 'fee_to_advance' ELSE '?' END
         OR bank_transaction_id IS DISTINCT FROM p_bank_txn OR bill_id IS DISTINCT FROM p_bill))
       OR (SELECT coalesce(sum(abs(amount)) FILTER (WHERE bucket = 'advance' OR kind = 'advance_to_fee' AND bucket = 'fee' OR kind = 'fee_to_advance' AND bucket = 'fee'), 0)
           FROM public.party_money_entries WHERE request_id = p_request_id AND NOT (kind = 'payment_split' AND bucket = 'fee'))
          <> (CASE WHEN p_action IN ('to_fee', 'to_advance') THEN 2 * round(coalesce(p_amount, 0), 2) ELSE round(coalesce(p_amount, 0), 2) END)
       OR (p_action = 'split' AND (SELECT coalesce(sum(amount), 0) FROM public.party_money_entries WHERE request_id = p_request_id AND bucket = 'fee') <> round(coalesce(p_fee, 0), 2)) THEN
      RAISE EXCEPTION 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'repeat', true);  -- the same click arrived twice — the first one stands
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-party:' || p_party, 0));
  -- PRIVATE MONEY (Codex 17 Nov 19:50): a caller who may not see some private accounts (p_hidden_accounts given) cannot move a
  -- pool that holds ANY money from them — checked over the WHOLE ledger of this company, under its lock. A source line that
  -- is missing or has no account counts as private (fails closed).
  IF p_hidden_accounts IS NOT NULL AND public.hub_party_pool_restricted(p_party, p_hidden_accounts) THEN
    RAISE EXCEPTION 'HUB_GUARD: %''s advance includes money from a private account — only someone allowed to see private accounts can move it.', p_party;
  END IF;
  SELECT coalesce(sum(amount) FILTER (WHERE bucket = 'advance'), 0), coalesce(sum(amount) FILTER (WHERE bucket = 'fee'), 0)
    INTO v_adv, v_fee FROM public.party_money_entries WHERE party = p_party;

  IF p_action = 'split' THEN
    IF v_amt < 0 OR v_fee_amt < 0 OR (v_amt + v_fee_amt) <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the advance and / or the fee (above zero).'; END IF;
    IF p_bank_txn IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: pick the bank line of the payment.'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-bank-line:' || p_bank_txn::text, 0)); -- same lock as bill payments (TO)
    SELECT id, amount_abs, direction, wave_business_id, third_party_payer, pending, account_id INTO v_line FROM public.bank_transactions WHERE id = p_bank_txn;
    IF v_line.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank line was not found.'; END IF;
    IF p_hidden_accounts IS NOT NULL AND (v_line.account_id IS NULL OR v_line.account_id = ANY (p_hidden_accounts)) THEN
      RAISE EXCEPTION 'HUB_GUARD: that bank line is in a private account.';
    END IF;
    IF v_line.direction <> 'out' OR v_line.pending IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: only a settled money-out line can be split.'; END IF;
    IF lower(coalesce(v_line.third_party_payer, '')) <> lower(p_party) THEN RAISE EXCEPTION 'HUB_GUARD: that bank line is not marked as a payment to %.', p_party; END IF;
    SELECT coalesce(sum(amount), 0) INTO v_line_used FROM public.vendor_bill_payments WHERE bank_transaction_id = p_bank_txn AND voided IS NOT TRUE;
    SELECT coalesce(sum(amount), 0) INTO v_split FROM public.party_money_entries WHERE bank_transaction_id = p_bank_txn AND kind = 'payment_split';
    -- a service fee already recorded on a funded wire request for this same bank line counts as used too
    IF to_regclass('public.wire_packages') IS NOT NULL THEN
      v_split := v_split + coalesce((SELECT sum(fee_amount) FROM public.wire_packages WHERE bank_transaction_id = p_bank_txn AND status = 'attached' AND fee_amount > 0), 0);
    END IF;
    IF v_line_used + v_split + v_amt + v_fee_amt > v_line.amount_abs + 0.005 THEN
      RAISE EXCEPTION 'HUB_GUARD: the payment is %; bills already take %, earlier splits / wire fees %, this split % — over by %.', round(v_line.amount_abs, 2), round(v_line_used, 2), round(v_split, 2), round(v_amt + v_fee_amt, 2), round(v_line_used + v_split + v_amt + v_fee_amt - v_line.amount_abs, 2);
    END IF;
    IF v_amt > 0 THEN INSERT INTO public.party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, reason, request_id, created_by) VALUES (p_party, 'advance', v_amt, 'payment_split', p_bank_txn, v_action, p_reason, p_request_id, p_actor); END IF;
    IF v_fee_amt > 0 THEN INSERT INTO public.party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, reason, request_id, created_by) VALUES (p_party, 'fee', v_fee_amt, 'payment_split', p_bank_txn, v_action, p_reason, p_request_id, p_actor); END IF;

  ELSIF p_action = 'apply' THEN
    IF v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount to apply (above zero).'; END IF;
    IF v_amt > v_adv + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the % advance is only % — cannot apply %.', p_party, round(v_adv, 2), v_amt; END IF;
    SELECT id, record_status, paid_via, wave_business_id INTO v_bill FROM public.vendor_bills WHERE id = p_bill;
    IF v_bill.id IS NULL OR v_bill.record_status <> 'active' THEN RAISE EXCEPTION 'HUB_GUARD: that bill is not an open bill.'; END IF;
    IF lower(coalesce(v_bill.paid_via, '')) <> lower(p_party) THEN RAISE EXCEPTION 'HUB_GUARD: that bill is not paid via % — only their bills can be paid from their advance.', p_party; END IF;
    -- the bill payment: the TO guard on vendor_bill_payments locks the bill and refuses paying it beyond its total
    INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by, request_id)
      VALUES (p_bill, v_amt, (now() AT TIME ZONE 'America/New_York')::date, NULL, 'advance', p_actor, p_request_id) RETURNING id INTO v_pay;
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, bill_id, bill_payment_id, action_id, reason, request_id, created_by)
      VALUES (p_party, 'advance', -v_amt, 'apply_to_bill', p_bill, v_pay, v_action, p_reason, p_request_id, p_actor);

  ELSIF p_action = 'to_fee' THEN
    IF v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount (above zero).'; END IF;
    IF v_amt > v_adv + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the % advance is only % — cannot turn % into a fee.', p_party, round(v_adv, 2), v_amt; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'HUB_GUARD: say why.'; END IF;
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, request_id, created_by) VALUES
      (p_party, 'advance', -v_amt, 'advance_to_fee', v_action, p_reason, p_request_id, p_actor),
      (p_party, 'fee', v_amt, 'advance_to_fee', v_action, p_reason, p_request_id, p_actor);

  ELSIF p_action = 'to_advance' THEN
    IF v_amt <= 0 THEN RAISE EXCEPTION 'HUB_GUARD: type the amount (above zero).'; END IF;
    IF v_amt > v_fee + 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the % fees on record are only % — cannot turn % back into advance.', p_party, round(v_fee, 2), v_amt; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'HUB_GUARD: say why.'; END IF;
    INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, request_id, created_by) VALUES
      (p_party, 'fee', -v_amt, 'fee_to_advance', v_action, p_reason, p_request_id, p_actor),
      (p_party, 'advance', v_amt, 'fee_to_advance', v_action, p_reason, p_request_id, p_actor);
  ELSE
    RAISE EXCEPTION 'HUB_GUARD: unknown action %.', p_action;
  END IF;

  -- final check under the lock: neither bucket can ever be below zero
  SELECT coalesce(sum(amount) FILTER (WHERE bucket = 'advance'), 0), coalesce(sum(amount) FILTER (WHERE bucket = 'fee'), 0)
    INTO v_adv, v_fee FROM public.party_money_entries WHERE party = p_party;
  IF v_adv < -0.005 OR v_fee < -0.005 THEN RAISE EXCEPTION 'HUB_GUARD: that would take the % balance below zero.', p_party; END IF;
  RETURN jsonb_build_object('ok', true, 'action_id', v_action, 'advance_balance', round(v_adv, 2), 'fee_total', round(v_fee, 2), 'bill_payment_id', v_pay);
END $$;

-- the Hub checks this before offering any advance action
CREATE OR REPLACE FUNCTION public.hub_party_money_installed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_party_money' AND pronargs = 10)
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_party_pool_status')
     AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'party_money_entries_append_only')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_payment_guards_installed');
$$;

-- only the server may call the money function
REVOKE ALL ON FUNCTION public.hub_party_money(text, text, numeric, numeric, uuid, uuid, text, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_pool_status(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_party_pool_restricted(text, text[]) FROM PUBLIC, anon, authenticated;

-- check: select party, bucket, sum(amount) from party_money_entries group by 1, 2;
