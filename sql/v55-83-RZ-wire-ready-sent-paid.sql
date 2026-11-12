-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RZ — Max, Nov 10 00:17–00:22 (confirmed):
--  "when it is ready to make payment by bank ... the status of each bill goes from OPEN to READY ... when the wire is
--   actually sent and you see a transaction for that amount in clickbooks ... automatically match those underlying bills
--   to that transaction and the status of the bills become PAID"
--  "we should be able to delete or cancel a wire after final approvals by the super admin" (1: yes — super admin only)
--  bank fee: a bank line up to $50 over the wire total matches automatically, the fee booked as a bank fee (2: yes)
--  "for those bills paid prior to this function — retroactively — we should be able to update the date of the wire and
--   you will look for the actual wire that was sent for that set of bills ... and match them"
--  "also need to be able to partially pay a bill"
-- Safe to re-run. Run after RL (and RS for the bank-fee booking).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) a wire recorded AFTER THE FACT (sent before the Hub had wires): no signatures, recorded by a super admin with a reason
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS after_the_fact boolean NOT NULL DEFAULT false;
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS after_the_fact_note text;
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS bank_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS matched_auto boolean NOT NULL DEFAULT false;
ALTER TABLE public.wire_packages DROP CONSTRAINT IF EXISTS wpkg_sent_complete;
ALTER TABLE public.wire_packages ADD CONSTRAINT wpkg_sent_complete CHECK (status NOT IN ('sent', 'attached') OR (
  sent_by IS NOT NULL AND approved_total IS NOT NULL AND (
    (signoff1_by IS NOT NULL AND signoff2_by IS NOT NULL)
    OR (after_the_fact AND length(btrim(COALESCE(after_the_fact_note, ''))) >= 10))));
-- v55.83-SC (Max Nov 12 09:40): a service fee may be added on a wire to RTM Capital OR NextTrade (never straight to a vendor)
ALTER TABLE public.wire_packages DROP CONSTRAINT IF EXISTS wpkg_affiliate_bills_only;
ALTER TABLE public.wire_packages ADD CONSTRAINT wpkg_affiliate_bills_only CHECK (payee_kind IN ('service_provider', 'affiliate') OR fee_amount = 0);
ALTER TABLE public.wire_packages DROP CONSTRAINT IF EXISTS wpkg_bank_fee_range;
ALTER TABLE public.wire_packages ADD CONSTRAINT wpkg_bank_fee_range CHECK (bank_fee >= 0 AND bank_fee <= 100); -- v55.83-SB: Max Nov 12 — up to $100

-- 2) locks (replaces RL): as before, plus — while SENT and not yet attached — the sent DATE may be corrected (audited by the
--    Hub); attaching may record the bank fee and whether the Hub matched it by itself
CREATE OR REPLACE FUNCTION public.wpkg_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: only a draft package can be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('cancelled', 'reversed') THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a % package cannot change', OLD.status; END IF;
  IF OLD.status IN ('sent', 'attached') THEN
    IF NEW.payee_name IS DISTINCT FROM OLD.payee_name OR NEW.payee_kind IS DISTINCT FROM OLD.payee_kind
       OR NEW.fee_amount IS DISTINCT FROM OLD.fee_amount OR NEW.approved_total IS DISTINCT FROM OLD.approved_total
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

-- 3) the wire charge in ClickBooks (Max 00:22: "2 yes"; 16:37: it goes toward the bill): a wire STRAIGHT TO A VENDOR whose bank line is up to $50 over the
--    wire total is booked in pieces — each bill → its category (commission → its own account, RS), the extra → the category of the bill it paid.
--    UPDATED (Max, Nov 10 16:37): the extra charge is NOT a bank fee — it goes with the bill it paid (that bill's category,
--    cost of goods by default). A wire to RTM Capital / NextTrade stays one line under professional fees (the Hub files
--    that bank line under the professional-fees category when it matches it).
--    Needs RS (commission ledger) run first; skipped quietly when the ClickBooks ledger is not installed.
DO $rz$
BEGIN
IF to_regprocedure('clickbooks_us.pays_commission_bill(uuid)') IS NULL THEN
  RAISE NOTICE 'RZ: ClickBooks commission ledger (RS) not installed — wire-charge booking skipped. Run RS, then this file again.';
  RETURN;
END IF;
EXECUTE $def$
create or replace function clickbooks_us.wire_fee_cents(p_txn uuid) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare f numeric;
begin
  if to_regclass('public.wire_packages') is null then return 0; end if;
  select coalesce(max(w.bank_fee), 0) into f from public.wire_packages w
   where w.bank_transaction_id = p_txn and w.status = 'attached' and w.payee_kind = 'vendor';
  return round(coalesce(f, 0) * 100)::bigint;
end $$;
$def$;
EXECUTE $def$
create or replace function clickbooks_us.has_piecewise(p_txn uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.accounting_invoice_payments p where p.bank_transaction_id = p_txn and p.voided is not true)
      or exists(select 1 from public.unapplied_deposits u where u.bank_transaction_id = p_txn and (u.status is null or u.status = 'open'))
      or exists(select 1 from public.customer_credits c where c.source_transaction_id = p_txn and (c.status is null or c.status = 'open'))
      or exists(select 1 from public.bank_transaction_splits s where s.bank_transaction_id = p_txn and coalesce(s.linked_type, '') <> 'invoice')
      -- RS: money out that pays a bill carrying a commission (NexPac) is booked in pieces: cost → the bill's category, commission → its own account
      or clickbooks_us.pays_commission_bill(p_txn)
      -- RZ: a wire straight to a vendor whose bank line carried an extra charge: bills → their categories, the extra → the bill’s category
      or clickbooks_us.wire_fee_cents(p_txn) > 0
$$;
$def$;
EXECUTE $def$
create or replace function clickbooks_us.deposit_lines(p_book uuid, p_txn uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; t record; bank_gl uuid; ar uuid; unap uuid; amt bigint;
  bad int; tot bigint; only_ar boolean; lines jsonb; inv_missing int;
  comm_acct uuid; bill_mode boolean := false; fee_c bigint := 0; has_bills boolean := false; billed_c bigint := 0; rest_acct uuid; nocat int := 0;
begin
  select * into b from clickbooks_us.books where id = p_book;
  select bt.* into t from public.bank_transactions bt where bt.id = p_txn;
  if not found then return jsonb_build_object('ok', false, 'why', 'transaction no longer in the hub'); end if;
  if t.wave_business_id is distinct from b.wave_business_id or t.iso_currency is distinct from 'USD' then return jsonb_build_object('ok', false, 'why', 'other books or currency'); end if;
  if t.pending is true then return jsonb_build_object('ok', false, 'why', 'still pending'); end if;
  if t.review_status = 'duplicate' then return jsonb_build_object('ok', false, 'why', 'marked as a duplicate copy'); end if;
  if t.review_status is distinct from 'reviewed' and t.review_status is distinct from 'approved' then return jsonb_build_object('ok', false, 'why', 'not finished (reviewed) yet'); end if;
  if t.transfer_group_id is not null then return jsonb_build_object('ok', false, 'why', 'paired transfer'); end if;
  if t.direction is distinct from 'in' and t.direction is distinct from 'out' then return jsonb_build_object('ok', false, 'why', 'no direction'); end if;
  if not clickbooks_us.has_piecewise(t.id) then return jsonb_build_object('ok', false, 'why', 'whole-category row (classified path)'); end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m
    join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = m.book_id
   where m.book_id = p_book and m.provider_account_id = t.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive;
  if bank_gl is null then return jsonb_build_object('ok', false, 'why', 'bank account has no ledger account yet'); end if;
  select a.id into ar from clickbooks_us.accounts a where a.book_id = p_book and a.code = '1100' and a.is_active and not a.needs_review;
  select a.id into unap from clickbooks_us.accounts a where a.book_id = p_book and a.code = '2400' and a.is_active and not a.needs_review;
  if ar is null or unap is null then return jsonb_build_object('ok', false, 'why', 'receivable (1100) or unapplied receipts (2400) not approved'); end if;
  amt := round(t.amount_abs * 100)::bigint;
  if t.direction = 'in' then
    select count(*) into inv_missing from public.accounting_invoice_payments p
     where p.bank_transaction_id = t.id and p.voided is not true
       and not exists(select 1 from clickbooks_us.journals j where j.book_id = p_book and j.source_kind = 'accounting_invoice'
                        and (j.source_id = p.accounting_invoice_id::text or j.source_id like p.accounting_invoice_id::text || ':r%')
                        and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = j.id))
       and not exists(select 1 from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id = o.run_id and mr.state = 'committed'
                       where o.book_id = p_book and o.kind = 'receivable' and o.source_ref = p.accounting_invoice_id::text);
    if inv_missing > 0 then return jsonb_build_object('ok', false, 'why', 'an invoice it pays is not in the ledger yet'); end if;
  elsif exists(select 1 from public.accounting_invoice_payments p where p.bank_transaction_id = t.id and p.voided is not true)
     or exists(select 1 from public.unapplied_deposits u where u.bank_transaction_id = t.id and (u.status is null or u.status = 'open'))
     or exists(select 1 from public.customer_credits c where c.source_transaction_id = t.id and (c.status is null or c.status = 'open')) then
    return jsonb_build_object('ok', false, 'why', 'money out cannot carry invoice payments or parked receipts');
  end if;
  -- RS: the bills this money-out pays (not through another company) — cost to the bill's category, commission to its own account
  if t.direction = 'out' and to_regclass('public.vendor_bill_payments') is not null then
    select count(*) > 0, coalesce(sum(round(vp.amount * 100)), 0)::bigint,
           count(*) filter (where clickbooks_us.category_account(p_book, vb.category) is null)
      into has_bills, billed_c, nocat
      from public.vendor_bill_payments vp join public.vendor_bills vb on vb.id = vp.bill_id
     where vp.bank_transaction_id = p_txn and vp.voided is not true and coalesce(vp.method, '') <> 'rtm' and vb.record_status = 'active';
    fee_c := clickbooks_us.wire_fee_cents(p_txn);
    if has_bills and (clickbooks_us.pays_commission_bill(p_txn) or fee_c > 0) then
      bill_mode := true;
      if clickbooks_us.pays_commission_bill(p_txn) then
        comm_acct := clickbooks_us.commission_account(p_book);
        if comm_acct is null then return jsonb_build_object('ok', false, 'why', 'the commission account is not approved yet'); end if;
      end if;
      if nocat > 0 then return jsonb_build_object('ok', false, 'why', 'a bill it pays has no category with a ledger account'); end if;
      -- whatever is left of the bank amount beyond the bills: the wire's extra charge goes WITH THE BILL it paid —
      -- the category of the (largest) bill on that wire, cost of goods as bills normally are (Max, Nov 10 16:37:
      -- "if wire sent straight to vendor...it will go toward the actual bill it was paid toward... what bank fee");
      -- otherwise the transaction's own category
      if billed_c < amt then
        if fee_c > 0 and amt - billed_c = fee_c then
          select clickbooks_us.category_account(p_book, vb.category) into rest_acct
            from public.vendor_bill_payments vp join public.vendor_bills vb on vb.id = vp.bill_id
           where vp.bank_transaction_id = p_txn and vp.voided is not true and coalesce(vp.method, '') <> 'rtm' and vb.record_status = 'active'
           order by vp.amount desc, vb.id limit 1;
          if rest_acct is null then return jsonb_build_object('ok', false, 'why', 'the bill it paid has no category with a ledger account'); end if;
        else
          rest_acct := clickbooks_us.category_account(p_book, t.classification);
          if rest_acct is null then return jsonb_build_object('ok', false, 'why', 'part of it pays no bill and it has no category for the rest'); end if;
        end if;
      end if;
    end if;
  end if;
  with parts as (
    select ar as acct, round(p.amount * 100)::bigint as cents from public.accounting_invoice_payments p where p.bank_transaction_id = p_txn and p.voided is not true
    union all
    select unap, round(u.amount * 100)::bigint from public.unapplied_deposits u where u.bank_transaction_id = p_txn and (u.status is null or u.status = 'open')
    union all
    select unap, round(c.amount * 100)::bigint from public.customer_credits c where c.source_transaction_id = p_txn and (c.status is null or c.status = 'open')
    union all
    select coalesce(
             (select cm.account_id from clickbooks_us.classification_account_map cm
                join clickbooks_us.accounts a on a.id = cm.account_id and a.book_id = p_book
               where cm.classification = trim(s.category) and cm.reviewed and a.is_active and not a.needs_review and not a.is_bank_sensitive),
             (select (array_agg(a2.id order by a2.id::text))[1] from clickbooks_us.accounts a2
               where a2.book_id = p_book and a2.is_active and not a2.needs_review and not a2.is_bank_sensitive
                 and lower(trim(a2.name)) = lower(trim(s.category)) having count(*) = 1),
             case when t.direction = 'in' then unap end),
           round(s.split_amount * 100)::bigint
      from public.bank_transaction_splits s where s.bank_transaction_id = p_txn and coalesce(s.linked_type, '') <> 'invoice'
    union all -- RS: each bill's cost part
    select clickbooks_us.category_account(p_book, vb.category),
           round(vp.amount * 100)::bigint - clickbooks_us.bill_commission_cents(vb.id, round(vp.amount * 100)::bigint)
      from public.vendor_bill_payments vp join public.vendor_bills vb on vb.id = vp.bill_id
     where bill_mode and vp.bank_transaction_id = p_txn and vp.voided is not true and coalesce(vp.method, '') <> 'rtm' and vb.record_status = 'active'
    union all -- RS: each bill's commission part → the commission account
    select comm_acct, clickbooks_us.bill_commission_cents(vb.id, round(vp.amount * 100)::bigint)
      from public.vendor_bill_payments vp join public.vendor_bills vb on vb.id = vp.bill_id
     where comm_acct is not null and vp.bank_transaction_id = p_txn and vp.voided is not true and coalesce(vp.method, '') <> 'rtm' and vb.record_status = 'active'
    union all -- RS: the rest of the bank amount (beyond the bills) → the transaction's own category
    select rest_acct, amt - billed_c where bill_mode and rest_acct is not null and amt > billed_c
  ), g as (select acct, sum(cents)::bigint as tot_c from parts group by acct)
  select (select count(*) from parts where acct is null),
         (select coalesce(sum(cents), 0)::bigint from parts),
         (select bool_and(acct = ar) from parts),
         (select jsonb_agg(x order by x->>0, (x->>1)::bigint, (x->>2)::bigint) from (
            select jsonb_build_array(bank_gl::text, case when t.direction = 'in' then amt else 0 end, case when t.direction = 'in' then 0 else amt end) as x
            union all
            select jsonb_build_array(g.acct::text, case when t.direction = 'in' then 0 else g.tot_c end, case when t.direction = 'in' then g.tot_c else 0 end)
              from g where g.acct is not null and g.tot_c <> 0) q)
    into bad, tot, only_ar, lines;
  if bad > 0 then return jsonb_build_object('ok', false, 'why', 'a split line''s category has no ledger account'); end if;
  if tot <> amt then return jsonb_build_object('ok', false, 'why', 'not every dollar is placed yet'); end if;
  if t.direction = 'in' and only_ar then return jsonb_build_object('ok', false, 'why', 'paid in full by invoice payments (the payment entries book it)'); end if;
  return jsonb_build_object('ok', true, 'lines', lines);
end $$;
$def$;
END $rz$;
