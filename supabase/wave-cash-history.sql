-- Additive research archive. Install after wave-history.sql. No operational books are written.
begin;
create table if not exists wave_history.cash_imports (
  id bigint generated always as identity primary key,
  fingerprint text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  company text not null default 'Nextrade LLC' check (company = 'Nextrade LLC'),
  basis text not null default 'cash' check (basis = 'cash'),
  date_from date not null, date_to date not null check (date_to >= date_from),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  file_name text not null, raw_csv text not null,
  row_count integer not null, debit_minor bigint not null, credit_minor bigint not null,
  imported_by uuid not null, imported_at timestamptz not null default now(),
  check (debit_minor = credit_minor and debit_minor >= 0)
);
create table if not exists wave_history.cash_entries (
  import_id bigint not null references wave_history.cash_imports(id),
  source_row integer not null, posted_date date not null,
  account_key text not null, account_name text not null, description text not null,
  debit_minor bigint not null check (debit_minor >= 0), credit_minor bigint not null check (credit_minor >= 0),
  check (debit_minor = 0 or credit_minor = 0), primary key(import_id, source_row)
);
create index if not exists wave_cash_entries_date on wave_history.cash_entries(posted_date, account_key);
create table if not exists wave_history.cash_mappings (
  account_key text primary key,
  kind text not null check (kind in ('expense','income','other','unclassified')),
  nextrade_category text, ktc_category text,
  revision integer not null, updated_by uuid not null, updated_at timestamptz not null default now()
);
create table if not exists wave_history.cash_mapping_history (
  id bigint generated always as identity primary key, account_key text not null,
  before_value jsonb, after_value jsonb not null, actor uuid not null, changed_at timestamptz not null default now()
);
alter table wave_history.cash_imports enable row level security;
alter table wave_history.cash_entries enable row level security;
alter table wave_history.cash_mappings enable row level security;
alter table wave_history.cash_mapping_history enable row level security;
revoke all on wave_history.cash_imports, wave_history.cash_entries, wave_history.cash_mappings, wave_history.cash_mapping_history from public, anon, authenticated, service_role;
grant select, insert on wave_history.cash_imports, wave_history.cash_entries, wave_history.cash_mapping_history to service_role;
grant select, insert, update on wave_history.cash_mappings to service_role;
revoke all on sequence wave_history.cash_imports_id_seq, wave_history.cash_mapping_history_id_seq from public, anon, authenticated, service_role;
grant usage on sequence wave_history.cash_imports_id_seq, wave_history.cash_mapping_history_id_seq to service_role;

create or replace function public.wave_cash_save(p_actor uuid, p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i wave_history.cash_imports%rowtype; n integer; dr bigint; cr bigint;
begin
  if not exists(select 1 from wave_history.access_grants where auth_user_id=p_actor and can_manage) then
    raise exception using errcode='42501', message='Wave History manage access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wave-cash:nextrade',0));
  select * into i from wave_history.cash_imports where fingerprint=p_data->>'fingerprint';
  if found then return jsonb_build_object('id',i.id,'rows',i.row_count,'unchanged',true); end if;
  if p_data->>'profile' is distinct from 'Nextrade LLC' or p_data->>'basis' is distinct from 'cash' then
    raise exception using errcode='22023',message='Wrong source company or report basis';
  end if;
  if exists(select 1 from wave_history.cash_imports where currency=p_data->>'currency'
    and date_from <= (p_data->>'end')::date and date_to >= (p_data->>'start')::date) then
    raise exception using errcode='22023',message='This cash report overlaps an archived period. Nothing imported; review the existing source first.';
  end if;
  insert into wave_history.cash_imports(fingerprint,date_from,date_to,currency,file_name,raw_csv,row_count,debit_minor,credit_minor,imported_by)
  values(p_data->>'fingerprint',(p_data->>'start')::date,(p_data->>'end')::date,p_data->>'currency',p_data->>'file_name',
    p_data->>'raw_csv',jsonb_array_length(p_data->'entries'),(p_data->>'debit')::bigint,(p_data->>'credit')::bigint,p_actor) returning * into i;
  insert into wave_history.cash_entries
  select i.id,r.source_row,r.posted_date,r.account_key,r.account_name,r.description,r.debit_minor,r.credit_minor
  from jsonb_to_recordset(p_data->'entries') as r(source_row integer,posted_date date,account_key text,account_name text,description text,debit_minor bigint,credit_minor bigint);
  select count(*),coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0) into n,dr,cr from wave_history.cash_entries where import_id=i.id;
  if n=0 or n<>i.row_count or dr<>i.debit_minor or cr<>i.credit_minor or
    exists(select 1 from wave_history.cash_entries where import_id=i.id and (posted_date<i.date_from or posted_date>i.date_to)) then
    raise exception using errcode='22023',message='Stored entries do not match the reconciled source';
  end if;
  return jsonb_build_object('id',i.id,'rows',n,'unchanged',false);
end;
$$;

create or replace function public.wave_cash_map(p_actor uuid,p_account text,p_kind text,p_nextrade text,p_ktc text,p_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare previous wave_history.cash_mappings%rowtype; saved wave_history.cash_mappings%rowtype;
begin
  if not exists(select 1 from wave_history.access_grants where auth_user_id=p_actor and can_manage) then
    raise exception using errcode='42501',message='Wave History manage access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wave-cash-map:'||p_account,0));
  if not exists(select 1 from wave_history.cash_entries where account_key=p_account) then
    raise exception using errcode='22023',message='Unknown original Wave account';
  end if;
  if p_nextrade is not null and not exists(select 1 from public.company_categories where company_id='NEXTRADE_BOOKS' and key=p_nextrade and active) then
    raise exception using errcode='22023',message='Choose an active NextTrade category';
  end if;
  if p_ktc is not null and not exists(select 1 from public.expense_categories where key=p_ktc and active) then
    raise exception using errcode='22023',message='Choose an active KTC category';
  end if;
  select * into previous from wave_history.cash_mappings where account_key=p_account;
  if coalesce(previous.revision,0)<>p_revision then raise exception using errcode='40001',message='Mapping changed; reload before saving'; end if;
  insert into wave_history.cash_mappings(account_key,kind,nextrade_category,ktc_category,revision,updated_by)
    values(p_account,p_kind,p_nextrade,p_ktc,p_revision+1,p_actor)
    on conflict(account_key) do update set kind=excluded.kind,nextrade_category=excluded.nextrade_category,
      ktc_category=excluded.ktc_category,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now() returning * into saved;
  insert into wave_history.cash_mapping_history(account_key,before_value,after_value,actor) values(p_account,to_jsonb(previous),to_jsonb(saved),p_actor);
  return to_jsonb(saved);
end;
$$;

create or replace function public.wave_cash_read(p_from date,p_to date,p_currency text,p_account text default null,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with scoped as (
    select e.* from wave_history.cash_entries e join wave_history.cash_imports i on i.id=e.import_id
    where i.currency=p_currency and e.posted_date between p_from and p_to
  ), totals as (
    select account_key,account_name,count(*) as rows,sum(debit_minor) as debit_minor,sum(credit_minor) as credit_minor
    from scoped group by account_key,account_name
  ) select jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('mapping',to_jsonb(m)) order by t.account_name,t.account_key)
      from totals t left join wave_history.cash_mappings m using(account_key)),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(x) from (select * from scoped where p_account is not null and account_key=p_account
      order by posted_date,import_id,source_row offset greatest(0,p_offset) limit 101) x),'[]'::jsonb),
    'imports',coalesce((select jsonb_agg(to_jsonb(i)-'raw_csv' order by date_from) from wave_history.cash_imports i
      where currency=p_currency and date_from<=p_to and date_to>=p_from),'[]'::jsonb),
    'mapping_history',coalesce((select jsonb_agg(h) from (select * from wave_history.cash_mapping_history
      where account_key=p_account order by id desc limit 50) h),'[]'::jsonb),
    'nextrade_categories',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label) order by label)
      from public.company_categories where company_id='NEXTRADE_BOOKS' and active),'[]'::jsonb),
    'ktc_categories',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label) order by label)
      from public.expense_categories where active),'[]'::jsonb)
  );
$$;
create or replace function public.wave_cash_source(p_id bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('file_name',file_name,'raw_csv',raw_csv) from wave_history.cash_imports where id=p_id;
$$;
revoke all on function public.wave_cash_save(uuid,jsonb),public.wave_cash_map(uuid,text,text,text,text,integer),
  public.wave_cash_read(date,date,text,text,integer),public.wave_cash_source(bigint) from public,anon,authenticated;
grant execute on function public.wave_cash_save(uuid,jsonb),public.wave_cash_map(uuid,text,text,text,text,integer),
  public.wave_cash_read(date,date,text,text,integer),public.wave_cash_source(bigint) to service_role;
commit;
