-- Historical reporting only. The Data API exposes service-role RPCs, not this schema.
begin;

create schema if not exists wave_history;
revoke all on schema wave_history from public, anon, authenticated;
grant usage on schema wave_history to service_role;

create table wave_history.access_grants (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  can_manage boolean not null default false,
  can_view_inventory boolean not null default false
);

create table wave_history.imports (
  business_id text not null,
  month_start date not null check (extract(day from month_start) = 1),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  wave_profile text not null check (length(btrim(wave_profile)) between 1 and 160),
  file_name text not null,
  fingerprint text not null,
  revision integer not null check (revision > 0),
  is_current boolean not null default true,
  row_count integer not null check (row_count >= 0),
  debit_minor bigint not null check (debit_minor >= 0),
  credit_minor bigint not null check (credit_minor = debit_minor),
  imported_by uuid not null,
  imported_at timestamptz not null default now(),
  primary key (business_id, month_start, revision)
);
create unique index wave_history_current_month on wave_history.imports (business_id, month_start) where is_current;

create table wave_history.entries (
  business_id text not null,
  month_start date not null,
  revision integer not null,
  source_row integer not null,
  posted_date date not null,
  transaction_ref text,
  description text not null,
  account_key text not null,
  account_name text not null,
  account_type text not null,
  account_group text not null,
  other_accounts text not null,
  kind text not null check (kind in ('expense', 'income', 'other', 'unclassified')),
  debit_minor bigint not null check (debit_minor >= 0),
  credit_minor bigint not null check (credit_minor >= 0),
  check (date_trunc('month', posted_date)::date = month_start),
  primary key (business_id, month_start, revision, source_row),
  foreign key (business_id, month_start, revision) references wave_history.imports (business_id, month_start, revision)
);

create table wave_history.category_overrides (
  business_id text not null,
  account_key text not null,
  category text check (length(btrim(category)) between 1 and 100),
  primary key (business_id, account_key)
);

alter table wave_history.imports enable row level security;
alter table wave_history.entries enable row level security;
alter table wave_history.category_overrides enable row level security;
alter table wave_history.access_grants enable row level security;
revoke all on all tables in schema wave_history from public, anon, authenticated;
grant select on wave_history.access_grants to service_role;
grant select, insert, update on wave_history.imports to service_role;
grant select, insert on wave_history.entries to service_role;
grant select, insert, update on wave_history.category_overrides to service_role;

create function public.wave_history_access(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('can_manage', a.can_manage, 'can_view_inventory', a.can_view_inventory)
  from wave_history.access_grants a where a.auth_user_id = p_user_id;
$$;

create function public.wave_history_save_month(
  p_business text, p_month date, p_currency text, p_wave_profile text, p_file_name text, p_fingerprint text,
  p_revision integer, p_debit bigint, p_credit bigint, p_actor uuid, p_entries jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  previous wave_history.imports%rowtype;
  next_revision integer;
  count_rows integer;
  debit_total bigint;
  credit_total bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('wave_history:' || p_business, 0));
  select * into previous from wave_history.imports where business_id = p_business and month_start = p_month and is_current;
  if previous.revision is not null and previous.fingerprint = p_fingerprint and previous.currency = p_currency
     and previous.wave_profile = p_wave_profile and previous.debit_minor = p_debit and previous.credit_minor = p_credit then
    return to_jsonb(previous) || jsonb_build_object('unchanged', true);
  end if;
  if coalesce(previous.revision, 0) <> p_revision then
    raise exception using errcode = '40001', message = 'Wave History month changed after preview';
  end if;
  if exists (select 1 from wave_history.imports where business_id = p_business and month_start <> p_month and is_current
      and lower(wave_profile) <> lower(p_wave_profile)) then
    raise exception using errcode = '22023', message = 'The Wave profile differs from the rest of the archive';
  end if;

  next_revision := coalesce(previous.revision, 0) + 1;
  update wave_history.imports set is_current = false
    where business_id = p_business and month_start = p_month and is_current;
  insert into wave_history.imports (business_id, month_start, currency, wave_profile, file_name, fingerprint, revision,
                                     row_count, debit_minor, credit_minor, imported_by)
    values (p_business, p_month, p_currency, p_wave_profile, p_file_name, p_fingerprint, next_revision, 0, p_debit, p_credit, p_actor);

  insert into wave_history.entries (
    business_id, month_start, revision, source_row, posted_date, transaction_ref, description, account_key,
    account_name, account_type, account_group, other_accounts, kind, debit_minor, credit_minor
  )
  select p_business, p_month, next_revision, r.source_row, r.posted_date, r.transaction_ref, r.description, r.account_key,
         r.account_name, r.account_type, r.account_group, r.other_accounts, r.kind, r.debit_minor, r.credit_minor
  from jsonb_to_recordset(p_entries) as r(
    source_row integer, posted_date date, transaction_ref text, description text, account_key text,
    account_name text, account_type text, account_group text, other_accounts text, kind text,
    debit_minor bigint, credit_minor bigint
  );

  select count(*)::integer, coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0)
    into count_rows, debit_total, credit_total
    from wave_history.entries where business_id = p_business and month_start = p_month and revision = next_revision;
  if debit_total is distinct from p_debit or credit_total is distinct from p_credit then
    raise exception 'Stored ledger totals differ from reconciled Wave totals';
  end if;
  update wave_history.imports set row_count = count_rows
    where business_id = p_business and month_start = p_month and revision = next_revision returning * into previous;
  return to_jsonb(previous) || jsonb_build_object('unchanged', false);
end;
$$;

create function public.wave_history_month(p_business text, p_month date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(i) - 'imported_by' - 'fingerprint' from wave_history.imports i
  where i.business_id = p_business and i.month_start = p_month and i.is_current;
$$;

create function public.wave_history_data(
  p_business text, p_currency text, p_current_start date, p_current_end date, p_prior_start date, p_prior_end date
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with periods as (
    select * from wave_history.imports i where i.business_id = p_business and i.currency = p_currency and i.is_current and
      (i.month_start >= p_current_start and i.month_start < p_current_end or
       i.month_start >= p_prior_start and i.month_start < p_prior_end)
  ), accounts as (
    select e.account_key, max(e.account_name) as account_name, e.kind, max(o.category) as category,
      sum(case when e.month_start >= p_current_start then
        case when e.kind = 'income' then e.credit_minor - e.debit_minor else e.debit_minor - e.credit_minor end
        else 0 end) as current_minor,
      sum(case when e.month_start < p_current_start then
        case when e.kind = 'income' then e.credit_minor - e.debit_minor else e.debit_minor - e.credit_minor end
        else 0 end) as prior_minor
    from periods i join wave_history.entries e using (business_id, month_start, revision)
    left join wave_history.category_overrides o using (business_id, account_key)
    where e.kind in ('expense', 'income') or (e.kind = 'unclassified' and o.category is not null)
    group by e.account_key, e.kind
  )
  select jsonb_build_object(
    'months', coalesce((select jsonb_agg(to_char(month_start, 'YYYY-MM') order by month_start) from periods), '[]'::jsonb),
    'wave_profile', (select wave_profile from periods order by month_start desc limit 1),
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.account_name, a.account_key) from accounts a), '[]'::jsonb),
    'unclassified', (select count(*) from periods i join wave_history.entries e using (business_id, month_start, revision)
      where e.kind = 'unclassified' and not exists (select 1 from wave_history.category_overrides o
        where o.business_id = p_business and o.account_key = e.account_key and o.category is not null))
  );
$$;

create function public.wave_history_entries(
  p_business text, p_currency text, p_from date, p_until date, p_account text, p_offset integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.posted_date, x.source_row), '[]'::jsonb) from (
    select e.posted_date, e.description, e.account_key, e.account_name, e.kind, e.other_accounts,
           e.debit_minor, e.credit_minor, e.transaction_ref, e.source_row, o.category
    from wave_history.entries e join wave_history.imports i using (business_id, month_start, revision)
    left join wave_history.category_overrides o using (business_id, account_key)
    where e.business_id = p_business and i.currency = p_currency and i.is_current and e.month_start >= p_from and e.month_start < p_until
      and (p_account is null or e.account_key = p_account)
    order by e.posted_date, e.source_row limit 101 offset greatest(p_offset, 0)
  ) x;
$$;

create function public.wave_history_set_category(p_business text, p_account text, p_category text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from wave_history.entries where business_id = p_business and account_key = p_account and kind <> 'other') then
    raise exception using errcode = '22023', message = 'Unknown Wave History account';
  end if;
  insert into wave_history.category_overrides values (p_business, p_account, p_category)
    on conflict (business_id, account_key) do update set category = excluded.category;
end;
$$;

create function public.wave_history_receipt_totals(
  p_current_start date, p_current_end date, p_prior_start date, p_prior_end date, p_product_filter text
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with receipts as (
    select r.receipt_date, r.quantity, coalesce(nullif(lower(btrim(r.uom)), ''), 'unspecified') as unit,
           p.id as product_id, p.name_en as product, p.quick_code, coalesce(f.label_en, 'Unassigned') as family
    from public.inventory_stock_receipts r
    join public.inventory_products p on p.id = r.product_id
    left join public.inventory_lists f on f.id = p.family_list_id
    where r.status in ('active', 'received', 'finalized') and r.receipt_type in ('new_shipment', 'legacy_import')
      and (r.receipt_date >= p_current_start and r.receipt_date < p_current_end or
           r.receipt_date >= p_prior_start and r.receipt_date < p_prior_end)
  ), filtered as (
    select * from receipts where p_product_filter is null or
      strpos(lower(concat_ws(' ', product, quick_code, family)), lower(p_product_filter)) > 0
  ), products as (
    select product_id, product, quick_code, family, unit,
      sum(quantity) filter (where receipt_date >= p_current_start) as current_quantity,
      sum(quantity) filter (where receipt_date < p_current_start) as prior_quantity
    from filtered group by product_id, product, quick_code, family, unit
  ), families as (
    select family, unit, sum(current_quantity) as current_quantity, sum(prior_quantity) as prior_quantity
    from products group by family, unit
  )
  select jsonb_build_object(
    'months_with_receipts', coalesce((select jsonb_agg(month order by month) from (
      select distinct to_char(receipt_date, 'YYYY-MM') as month from receipts) m), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) - 'product_id' order by p.product, p.unit, p.product_id) from (
      select * from products order by product, unit, product_id limit 100) p), '[]'::jsonb),
    'product_rows_total', (select count(*) from products),
    'families', coalesce((select jsonb_agg(to_jsonb(f) order by f.family, f.unit) from families f), '[]'::jsonb)
  );
$$;

-- Explicit grants also cover projects with automatic Data API exposure disabled.
revoke execute on function public.wave_history_save_month(text, date, text, text, text, text, integer, bigint, bigint, uuid, jsonb),
  public.wave_history_month(text, date), public.wave_history_data(text, text, date, date, date, date),
  public.wave_history_entries(text, text, date, date, text, integer), public.wave_history_set_category(text, text, text),
  public.wave_history_receipt_totals(date, date, date, date, text), public.wave_history_access(uuid)
  from public, anon, authenticated;
grant execute on function public.wave_history_save_month(text, date, text, text, text, text, integer, bigint, bigint, uuid, jsonb),
  public.wave_history_month(text, date), public.wave_history_data(text, text, date, date, date, date),
  public.wave_history_entries(text, text, date, date, text, integer), public.wave_history_set_category(text, text, text),
  public.wave_history_receipt_totals(date, date, date, date, text), public.wave_history_access(uuid)
  to service_role;

commit;
