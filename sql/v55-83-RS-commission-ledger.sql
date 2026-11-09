-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RS — Max, Nov 9 21:36: "clickbooks should book commission in its own account"
-- A bill with a commission (NexPac: cost, then 12.5% added to it — the Hub spreads the bill's commission line over its
-- products, v55.83-RQ) is now booked in two parts in ClickBooks:
--   • the COST  → the bill's category account (as before)
--   • the COMMISSION → its own account "Commission on purchases" (category key purchase_commission)
-- Where it applies:
--   1. a bill paid straight from our bank (💸 Bills payment or a wire straight to the vendor): the bank line is booked
--      in pieces by deposit_sync_run (cost / commission / anything left over → the line's own category);
--   2. a bill a related company (NextTrade) paid for us: affiliate_bill_sync_run books cost + commission against
--      "Due from NextTrade Industries".
--   A payment through RTM Capital (service provider) stays ONE professional-fee line, as decided before.
-- Entries already posted the old way are reversed and re-booked automatically by the next sync (audited) — unless their
-- period is locked. Every part of a payment is in proportion: commission part = payment × (bill commission ÷ bill total).
-- Paste into the Supabase SQL Editor AFTER RB and RQ, and Run. SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

-- the category (shows in every category list) and its ledger account
INSERT INTO public.expense_categories (key, label, sort) VALUES ('purchase_commission', 'Commission on purchases', 96)
ON CONFLICT (key) DO NOTHING;
UPDATE public.expense_categories SET kind = 'cogs' WHERE key = 'purchase_commission' AND kind = 'expense'
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expense_categories' AND column_name = 'kind');

create or replace function clickbooks_us.commission_account(p_book uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
  return clickbooks_us.category_account(p_book, 'purchase_commission');
end $$;

-- the commission part (in cents) of a payment of p_cents on a bill: payment × the bill's commission ÷ the bill total
create or replace function clickbooks_us.bill_commission_cents(p_bill uuid, p_cents bigint) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare com numeric; tot numeric;
begin
  if to_regclass('public.vendor_bill_lines') is null or p_cents is null or p_cents <= 0 then return 0; end if;
  select coalesce(sum(l.commission_amount), 0) into com from public.vendor_bill_lines l where l.bill_id = p_bill and l.line_kind = 'item';
  select vb.total_amount into tot from public.vendor_bills vb where vb.id = p_bill;
  if com <= 0 or tot is null or tot <= 0 then return 0; end if;
  return least(p_cents, round(p_cents * com / tot)::bigint);
end $$;

-- does this bank transaction pay (directly, not through another company) a bill that carries a commission?
create or replace function clickbooks_us.pays_commission_bill(p_txn uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare hit boolean := false;
begin
  if to_regclass('public.vendor_bill_lines') is null or to_regclass('public.vendor_bill_payments') is null then return false; end if;
  select exists(select 1 from public.vendor_bill_payments vp
                  join public.vendor_bill_lines l on l.bill_id = vp.bill_id and l.line_kind = 'item' and coalesce(l.commission_amount, 0) > 0
                 where vp.bank_transaction_id = p_txn and vp.voided is not true and coalesce(vp.method, '') <> 'rtm') into hit;
  return hit;
end $$;

create or replace function clickbooks_us.has_piecewise(p_txn uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.accounting_invoice_payments p where p.bank_transaction_id = p_txn and p.voided is not true)
      or exists(select 1 from public.unapplied_deposits u where u.bank_transaction_id = p_txn and (u.status is null or u.status = 'open'))
      or exists(select 1 from public.customer_credits c where c.source_transaction_id = p_txn and (c.status is null or c.status = 'open'))
      or exists(select 1 from public.bank_transaction_splits s where s.bank_transaction_id = p_txn and coalesce(s.linked_type, '') <> 'invoice')
      -- RS: money out that pays a bill carrying a commission (NexPac) is booked in pieces: cost → the bill's category, commission → its own account
      or clickbooks_us.pays_commission_bill(p_txn)
$$;

create or replace function clickbooks_us.deposit_lines(p_book uuid, p_txn uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; t record; bank_gl uuid; ar uuid; unap uuid; amt bigint;
  bad int; tot bigint; only_ar boolean; lines jsonb; inv_missing int;
  comm_acct uuid; has_bills boolean := false; billed_c bigint := 0; rest_acct uuid; nocat int := 0;
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
    if has_bills and clickbooks_us.pays_commission_bill(p_txn) then
      comm_acct := clickbooks_us.commission_account(p_book);
      if comm_acct is null then return jsonb_build_object('ok', false, 'why', 'the commission account is not approved yet'); end if;
      if nocat > 0 then return jsonb_build_object('ok', false, 'why', 'a bill it pays has no category with a ledger account'); end if;
      -- whatever is left of the bank amount beyond the bills goes to the transaction's own category (e.g. a wire fee)
      if billed_c < amt then
        rest_acct := clickbooks_us.category_account(p_book, t.classification);
        if rest_acct is null then return jsonb_build_object('ok', false, 'why', 'part of it pays no bill and it has no category for the rest'); end if;
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
     where comm_acct is not null and vp.bank_transaction_id = p_txn and vp.voided is not true and coalesce(vp.method, '') <> 'rtm' and vb.record_status = 'active'
    union all -- RS: each bill's commission part → the commission account
    select comm_acct, clickbooks_us.bill_commission_cents(vb.id, round(vp.amount * 100)::bigint)
      from public.vendor_bill_payments vp join public.vendor_bills vb on vb.id = vp.bill_id
     where comm_acct is not null and vp.bank_transaction_id = p_txn and vp.voided is not true and coalesce(vp.method, '') <> 'rtm' and vb.record_status = 'active'
    union all -- RS: the rest of the bank amount (beyond the bills) → the transaction's own category
    select rest_acct, amt - billed_c where comm_acct is not null and rest_acct is not null and amt > billed_c
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

create or replace function clickbooks_us.affbill_lines(p_book uuid, p_pay uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v record; bl record; due uuid; cat uuid; n bigint; cm bigint; cacct uuid;
begin
  select vp.* into v from public.vendor_bill_payments vp where vp.id = p_pay;
  if not found then return jsonb_build_object('ok', false, 'why', 'bill payment no longer in the hub'); end if;
  if v.voided is true then return jsonb_build_object('ok', false, 'why', 'bill payment voided'); end if;
  if coalesce(v.method, '') <> 'rtm' then return jsonb_build_object('ok', false, 'why', 'not paid through another company'); end if;
  select vb.* into bl from public.vendor_bills vb where vb.id = v.bill_id;
  if not found or bl.record_status is distinct from 'active' then return jsonb_build_object('ok', false, 'why', 'bill voided or deleted'); end if;
  due := clickbooks_us.affiliate_due_account(p_book, coalesce(nullif(trim(bl.paid_via), ''), 'RTM Capital'));
  if due is null then return jsonb_build_object('ok', false, 'why', 'paid through a service provider (stays one line)'); end if;
  cat := clickbooks_us.category_account(p_book, bl.category);
  if cat is null then return jsonb_build_object('ok', false, 'why', 'bill has no category with a ledger account'); end if;
  n := round(v.amount * 100)::bigint;
  if n <= 0 then return jsonb_build_object('ok', false, 'why', 'zero amount'); end if;
  -- RS (Max, Nov 9 21:36: "clickbooks should book commission in its own account")
  cm := clickbooks_us.bill_commission_cents(bl.id, n);
  if cm > 0 then
    cacct := clickbooks_us.commission_account(p_book);
    if cacct is null then return jsonb_build_object('ok', false, 'why', 'the commission account is not approved yet'); end if;
  end if;
  return jsonb_build_object('ok', true, 'date', v.paid_date, 'lines', (
    select jsonb_agg(x order by x->>0, (x->>1)::bigint, (x->>2)::bigint) from (
      select jsonb_build_array(cat::text, n - cm, 0) as x
      union all select jsonb_build_array(cacct::text, cm, 0) where cm > 0
      union all select jsonb_build_array(due::text, 0, n)) q));
end $$;
