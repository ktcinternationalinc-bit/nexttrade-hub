create table if not exists public.nextrade_bill_category_splits (
  transaction_id uuid primary key references public.bank_transactions(id),
  bill_id uuid not null references public.vendor_bills(id),
  allocations jsonb not null,
  revision integer not null check (revision > 0),
  check (jsonb_typeof(allocations) = 'array')
);
alter table public.nextrade_bill_category_splits enable row level security;
revoke all on public.nextrade_bill_category_splits from public,anon,authenticated,service_role;
grant select,insert,update on public.nextrade_bill_category_splits to service_role;

create or replace function public.hub_save_nextrade_bill_category_split(p jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  source_id uuid := (p->>'transaction_id')::uuid;
  actor uuid := (p->>'actor')::uuid;
  expected_revision integer := (p->>'revision')::integer;
  parts jsonb := p->'allocations';
  item jsonb;
  part_sum numeric := 0;
  categories text[] := '{}'::text[];
  next_revision integer;
  source record;
  linked record;
  existing record;
begin
  if actor is null or expected_revision is null or coalesce(jsonb_typeof(parts), '') <> 'array' then
    raise exception 'HUB_GUARD: Pick the bill and its category amounts.';
  end if;
  select t.id,t.amount_abs,t.company_category,t.direction,t.pending,t.transfer_group_id,t.review_status,t.iso_currency
    into source from public.bank_transactions t where t.id=source_id and t.wave_business_id='NEXTRADE_BOOKS' for update;
  if not found or source.direction is distinct from 'out' or coalesce(source.amount_abs,0)<=0 or source.pending is true or source.transfer_group_id is not null
    or source.review_status = 'duplicate' or upper(coalesce(source.iso_currency,'USD')) <> 'USD'
    or source.company_category='sales_ktc_managed_income' then
    raise exception 'HUB_GUARD: Choose a posted NextTrade expense bill.';
  end if;
  select b.id,b.total_amount into linked from public.company_bill_links l join public.vendor_bills b on b.id=l.bill_id
    where l.source_bank_transaction_id=source_id and l.company_id='NEXTRADE_BOOKS' and l.status='active'
      and coalesce(b.record_status,'active')='active' and upper(coalesce(b.currency,'USD'))='USD' for share of b;
  if linked.id is null or (jsonb_array_length(parts)>0 and round(linked.total_amount,2) is distinct from round(source.amount_abs,2)) then
    raise exception 'HUB_GUARD: The linked bill and transaction must have the same total.';
  end if;
  if exists(select from public.company_categories c where c.company_id='NEXTRADE_BOOKS' and c.key=source.company_category and c.is_payroll is true) then
    raise exception 'HUB_GUARD: Payroll bills use the payroll workflow.';
  end if;
  select s.revision,s.bill_id,s.allocations into existing from public.nextrade_bill_category_splits s where s.transaction_id=source_id;
  if coalesce(existing.revision,0) <> expected_revision then
    if existing.bill_id=linked.id and existing.allocations=parts then return jsonb_build_object('revision',existing.revision); end if;
    raise exception 'HUB_GUARD: Someone changed this split. Reload the transaction before saving.';
  end if;
  if jsonb_array_length(parts)=1 or jsonb_array_length(parts)>12 then
    raise exception 'HUB_GUARD: Choose 2 to 12 categories, or remove the split.';
  end if;
  for item in select value from jsonb_array_elements(parts) loop
    if coalesce(item->>'category','') = '' or item->>'category'=any(categories)
      or coalesce(item->>'cents','') !~ '^[1-9][0-9]{0,11}$'
      or coalesce(jsonb_typeof(item->'include_ktc'),'') <> 'boolean'
      or not exists(select from public.company_categories c where c.company_id='NEXTRADE_BOOKS' and c.key=item->>'category'
        and c.active is true and c.kind in ('expense','other_expense','cogs') and c.direction is distinct from 'in'
        and c.is_payroll is not true and c.key <> 'sales_ktc_managed_income') then
      raise exception 'HUB_GUARD: Use different eligible NextTrade categories and positive amounts.';
    end if;
    categories := array_append(categories,item->>'category');
    part_sum := part_sum+(item->>'cents')::numeric;
  end loop;
  if jsonb_array_length(parts)>0 and part_sum <> round(source.amount_abs*100) then
    raise exception 'HUB_GUARD: The category amounts must add up to the full bill total.';
  end if;
  next_revision := expected_revision+1;
  insert into public.nextrade_bill_category_splits(transaction_id,bill_id,allocations,revision) values(source_id,linked.id,parts,next_revision)
    on conflict (transaction_id) do update set bill_id=excluded.bill_id,allocations=excluded.allocations,revision=excluded.revision;
  insert into public.hub_audit_log(actor_id,action,entity,entity_id,details)
    values(actor,'nextrade_bill_category_split','vendor_bill',linked.id::text,jsonb_build_object('transaction_id',source_id,'previous',existing.allocations,'allocations',parts,'revision',next_revision));
  return jsonb_build_object('revision',next_revision);
end
$$;
revoke all on function public.hub_save_nextrade_bill_category_split(jsonb) from public,anon,authenticated;
grant execute on function public.hub_save_nextrade_bill_category_split(jsonb) to service_role;

create or replace function public.hub_guard_nextrade_split_category() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.wave_business_id='NEXTRADE_BOOKS' and new.company_category is distinct from old.company_category and exists
    (select from public.nextrade_bill_category_splits s join public.company_bill_links l on l.bill_id=s.bill_id and l.source_bank_transaction_id=s.transaction_id
      where s.transaction_id=old.id and jsonb_array_length(s.allocations)>0 and l.status='active') then
    raise exception 'HUB_GUARD: Edit or remove the bill category split first.';
  end if;
  return new;
end
$$;
revoke all on function public.hub_guard_nextrade_split_category() from public,anon,authenticated;
drop trigger if exists hub_guard_nextrade_split_category on public.bank_transactions;
create trigger hub_guard_nextrade_split_category before update of company_category on public.bank_transactions
  for each row execute function public.hub_guard_nextrade_split_category();

create or replace function public.hub_guard_nextrade_split_bill_amount() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if round(new.total_amount,2) is distinct from round(old.total_amount,2) and exists
    (select from public.nextrade_bill_category_splits s join public.company_bill_links l on l.bill_id=s.bill_id and l.source_bank_transaction_id=s.transaction_id
      where s.bill_id=old.id and jsonb_array_length(s.allocations)>0 and l.status='active') then
    raise exception 'HUB_GUARD: Remove the NextTrade category split before changing the bill total.';
  end if;
  return new;
end
$$;
revoke all on function public.hub_guard_nextrade_split_bill_amount() from public,anon,authenticated;
drop trigger if exists hub_guard_nextrade_split_bill_amount on public.vendor_bills;
create trigger hub_guard_nextrade_split_bill_amount before update of total_amount on public.vendor_bills
  for each row execute function public.hub_guard_nextrade_split_bill_amount();
