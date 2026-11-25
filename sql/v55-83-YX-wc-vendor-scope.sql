-- v55.83-YX — which vendors the Warehouse check looks at (Max 25 Nov: "only nexpac bills and only vendors we select").
-- Run ONCE in Supabase → SQL Editor, after XB (sql/v55-83-XB-weight-check.sql) and XW (sql/v55-83-XW-xb-wx-privileges.sql). Safe to run again.
--
-- Adds ONE table, wc_vendor_scope: each saved selection is a new numbered version (never edited, never deleted).
-- Until a selection is saved (or if this script has not been run yet) the Hub uses NexPac only — nothing else changes.
-- Only the server can read or write it; the browser cannot. No existing row anywhere is changed.

begin;

do $$
begin
  if to_regprocedure('public.wc_refuse_change()') is null or to_regprocedure('public.wc_refuse_truncate()') is null then
    raise exception 'YX: run the XB and XW scripts first (wc_refuse_change / wc_refuse_truncate are missing). Nothing was changed.';
  end if;
end $$;

create table if not exists public.wc_vendor_scope (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  vendor_keys text[] not null check (cardinality(vendor_keys) between 1 and 50),
  vendor_names text[] not null,
  note text,
  actor uuid not null,
  at timestamptz not null default now()
);

alter table public.wc_vendor_scope enable row level security;
revoke all on public.wc_vendor_scope from public, anon, authenticated, service_role;
grant select, insert on public.wc_vendor_scope to service_role;

drop trigger if exists wc_vendor_scope_no_change on public.wc_vendor_scope;
create trigger wc_vendor_scope_no_change before update or delete on public.wc_vendor_scope for each row execute function public.wc_refuse_change();
drop trigger if exists wc_vendor_scope_no_truncate on public.wc_vendor_scope;
create trigger wc_vendor_scope_no_truncate before truncate on public.wc_vendor_scope for each statement execute function public.wc_refuse_truncate();

commit;

-- check after running (read-only): one row, result OK
select 'wc_vendor_scope' as table_name,
       coalesce((select string_agg(p.priv, ', ' order by p.ord) from (values (1, 'SELECT'), (2, 'INSERT'), (3, 'UPDATE'), (4, 'DELETE'), (5, 'TRUNCATE')) p(ord, priv)
                 where has_table_privilege('service_role', 'public.wc_vendor_scope', p.priv)), 'none') as service_role_rights,
       case when has_table_privilege('anon', 'public.wc_vendor_scope', 'SELECT') or has_table_privilege('authenticated', 'public.wc_vendor_scope', 'SELECT') then 'HAS RIGHTS' else 'none' end as browser_rights,
       (select count(*) from public.wc_vendor_scope) as saved_versions,
       case when (select string_agg(p.priv, ', ' order by p.ord) from (values (1, 'SELECT'), (2, 'INSERT'), (3, 'UPDATE'), (4, 'DELETE'), (5, 'TRUNCATE')) p(ord, priv)
                  where has_table_privilege('service_role', 'public.wc_vendor_scope', p.priv)) = 'SELECT, INSERT'
             and not has_table_privilege('anon', 'public.wc_vendor_scope', 'SELECT') and not has_table_privilege('authenticated', 'public.wc_vendor_scope', 'SELECT')
             and exists (select 1 from pg_trigger where tgname = 'wc_vendor_scope_no_truncate') and exists (select 1 from pg_trigger where tgname = 'wc_vendor_scope_no_change')
            then 'OK' else 'PROBLEM' end as result;
