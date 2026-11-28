-- The zero-dollar row identifies the payment source. Its value comes only from bank receipts.
alter table public.party_opening_balances drop constraint party_opening_balances_amount_check;
alter table public.party_opening_balances add constraint party_opening_balances_amount_check
  check (amount = round(amount, 2) and (amount <> 0 or id = '92d12430-84be-4281-a81b-2b06d7805fa2'));
alter table public.party_opening_balances drop constraint party_opening_balances_sign;
alter table public.party_opening_balances add constraint party_opening_balances_sign
  check ((amount > 0 and corrects_id is null) or (amount < 0 and corrects_id is not null)
    or (amount = 0 and corrects_id is null and id = '92d12430-84be-4281-a81b-2b06d7805fa2' and party = 'NextTrade Industries'));

insert into public.party_opening_balances (id, party, amount, as_of, reason, visible_to_staff, request_id, created_by)
values ('92d12430-84be-4281-a81b-2b06d7805fa2','NextTrade Industries',0,'2026-06-01',
  'System source for posted NextTrade-managed sales receipts',false,'nexttrade-managed-sales-rolling','00000000-0000-0000-0000-000000000000')
on conflict (id) do nothing;

create or replace function public.hub_nextrade_managed_sales_lines(p_through date)
returns table(id uuid, date date, direction text, category text, amount numeric, account_id text, description text)
language sql stable security invoker set search_path = '' as $$
  select t.id, coalesce(t.posted_date,t.date), t.direction::text, t.company_category::text, round(t.amount_abs,2), t.account_id::text, t.name::text
  from public.bank_transactions t
  where t.wave_business_id = 'NEXTRADE_BOOKS' and coalesce(t.posted_date,t.date) <= p_through
    and t.pending is not true and t.review_status is distinct from 'duplicate' and t.transfer_group_id is null
    and coalesce(upper(t.iso_currency),'USD') = 'USD' and t.amount_abs > 0
    and ((t.company_category = 'sales' and t.direction in ('in','out'))
      or (t.company_category = 'sales_ktc_managed_income' and t.direction = 'out'))
$$;
revoke all on function public.hub_nextrade_managed_sales_lines(date) from public,anon,authenticated;
grant execute on function public.hub_nextrade_managed_sales_lines(date) to service_role;

create or replace function public.hub_nextrade_managed_sales_state(p_through date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with cash as (
    select coalesce(sum(l.amount) filter (where l.direction='in'),0) as sales,
      coalesce(sum(l.amount) filter (where l.category='sales_ktc_managed_income'),0) as remitted,
      coalesce(sum(l.amount) filter (where l.category='sales' and l.direction='out'),0) as reversed
    from public.hub_nextrade_managed_sales_lines(p_through) l
    where not exists (select from public.nextrade_managed_sales_balances b where b.source_period @> l.date)
  ), payments as (
    select coalesce(sum(round(p.amount,2)),0) as used,count(*) as count
    from public.vendor_bill_payments p where p.party_opening_id='92d12430-84be-4281-a81b-2b06d7805fa2'
      and p.voided is not true and p.paid_date <= p_through
  )
  select jsonb_build_object('sales',cash.sales,'remitted',cash.remitted,'reversed',cash.reversed,'used',payments.used,
    'payments',payments.count,'amount',cash.sales-cash.remitted-cash.reversed,
    'held',cash.sales-cash.remitted-cash.reversed-payments.used)
  from cash cross join payments
$$;
revoke all on function public.hub_nextrade_managed_sales_state(date) from public,anon,authenticated;
grant execute on function public.hub_nextrade_managed_sales_state(date) to service_role;

create or replace function public.hub_nextrade_managed_remittance_bill_ids()
returns table(bill_id uuid) language sql stable security invoker set search_path = '' as $$
  select distinct link.bill_id from public.company_bill_links link join public.bank_transactions t on t.id=link.source_bank_transaction_id
  where link.status='active' and t.wave_business_id='NEXTRADE_BOOKS' and t.company_category='sales_ktc_managed_income'
$$;
revoke all on function public.hub_nextrade_managed_remittance_bill_ids() from public,anon,authenticated;
grant execute on function public.hub_nextrade_managed_remittance_bill_ids() to service_role;

-- Preserve the existing calculation for every ordinary opening.
create or replace function public.hub_party_opening_state(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o record; v_corr numeric; v_nc int; v_used numeric; v_np int; v_amt numeric; rolling jsonb;
begin
  select b.id,b.party,b.amount,b.as_of,b.visible_to_staff,b.corrects_id into o from public.party_opening_balances b where b.id=p_id;
  if o.id is null then return jsonb_build_object('found',false); end if;
  if o.corrects_id is not null then
    select b.id,b.party,b.amount,b.as_of,b.visible_to_staff,b.corrects_id into o from public.party_opening_balances b where b.id=o.corrects_id;
  end if;
  if o.id='92d12430-84be-4281-a81b-2b06d7805fa2' then
    rolling := public.hub_nextrade_managed_sales_state((now() at time zone 'America/New_York')::date);
    return rolling || jsonb_build_object('found',true,'id',o.id,'party',o.party,'as_of',o.as_of,
      'visible_to_staff',o.visible_to_staff,'original',rolling->'sales','corrections',0,'corrections_count',0);
  end if;
  select coalesce(sum(round(c.amount,2)),0),count(*) into v_corr,v_nc from public.party_opening_balances c where c.corrects_id=o.id;
  v_amt := round(o.amount,2)+v_corr;
  select coalesce(sum(round(p.amount,2)),0),count(*) into v_used,v_np from public.vendor_bill_payments p where p.party_opening_id=o.id and p.voided is not true;
  return jsonb_build_object('found',true,'id',o.id,'party',o.party,'as_of',o.as_of,'visible_to_staff',o.visible_to_staff,
    'original',round(o.amount,2),'corrections',v_corr,'corrections_count',v_nc,'amount',v_amt,'used',v_used,'payments',v_np,'held',v_amt-v_used);
end
$$;

create or replace function public.hub_nextrade_managed_sales_pay_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare payment record; check_date date;
begin
  select p.paid_date,p.voided,p.party_opening_id,p.bill_id into payment from public.vendor_bill_payments p where p.id=new.id;
  if not found or payment.party_opening_id is distinct from '92d12430-84be-4281-a81b-2b06d7805fa2'::uuid or payment.voided is true then return null; end if;
  if exists (select from public.hub_nextrade_managed_remittance_bill_ids() link where link.bill_id=payment.bill_id) then
    raise exception 'HUB_GUARD: A remittance to KTC cannot be paid again from managed sales.';
  end if;
  for check_date in
    select payment.paid_date union select distinct p.paid_date from public.vendor_bill_payments p
    where p.party_opening_id=payment.party_opening_id and p.voided is not true and p.paid_date>payment.paid_date
  loop
    if (public.hub_nextrade_managed_sales_state(check_date)->>'held')::numeric < 0 then
      raise exception 'HUB_GUARD: Not enough NextTrade-managed sales were available on %.', check_date;
    end if;
  end loop;
  return null;
end
$$;
drop trigger if exists hub_nextrade_managed_sales_pay_guard on public.vendor_bill_payments;
create constraint trigger hub_nextrade_managed_sales_pay_guard after insert or update on public.vendor_bill_payments
  deferrable initially deferred for each row execute function public.hub_nextrade_managed_sales_pay_guard();
revoke all on function public.hub_nextrade_managed_sales_pay_guard() from public,anon,authenticated;

-- Ability to make a manual capture is retired with the rolling source.
revoke execute on function public.hub_nextrade_managed_sales_add(jsonb) from service_role;
