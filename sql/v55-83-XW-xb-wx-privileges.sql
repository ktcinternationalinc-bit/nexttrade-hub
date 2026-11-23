-- v55.83-XW — tighten the rights on the EXISTING warehouse-check (XB) and bill-rule (WX) tables (Codex 23 Nov 18:41). Run ONCE in Supabase → SQL Editor. Safe to run again.
--
-- Why: Supabase gives its server role (service_role) EVERY right on a new table by default, including DELETE and TRUNCATE (empty a whole table).
--      The XB and WX scripts took the rights away from the browser roles but not from service_role, so the server role could still empty these tables.
--      The Hub screens never do this; this closes the door anyway, because these records are "never deleted" (Max's rule).
--
-- What it does — ONLY on these 11 tables (nothing else in the database is touched, no row is changed or removed):
--   XB  wc_fetch_runs, wc_receipt_versions, wc_ref_searches, wc_receipt_seen, wc_links, wc_product_maps, wc_tolerances,
--       wc_decisions, wc_reports, wc_report_items
--         → the server may only READ and ADD rows (and FINISH a warehouse read in wc_fetch_runs, which needs UPDATE there).
--   WX  bill_category_rules
--         → the server may READ, ADD and CHANGE a rule (switching one off is a change); never delete it.
--   Every one of the 11 also gets a guard that refuses "empty the whole table" (TRUNCATE) for everybody.
--   The browser roles (anon, authenticated) keep NO rights on any of them. The report-saving function keeps working.
-- If XB or WX is not installed, it stops at the first line and changes nothing.

begin;

do $$
declare t text;
begin
  foreach t in array array['wc_fetch_runs', 'wc_receipt_versions', 'wc_ref_searches', 'wc_receipt_seen', 'wc_links', 'wc_product_maps',
                           'wc_tolerances', 'wc_decisions', 'wc_reports', 'wc_report_items', 'bill_category_rules'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'XW: table public.% is missing — run the XB and WX scripts first. Nothing was changed.', t;
    end if;
  end loop;
end $$;

-- "empty the whole table" is refused (statement-level guard; the existing row guards only cover UPDATE / DELETE of single rows)
create or replace function public.wc_refuse_truncate() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'XB: TRUNCATE on % is refused — weight-check records are never deleted', tg_table_name;
end $$;
revoke all on function public.wc_refuse_truncate() from public, anon, authenticated, service_role;

create or replace function public.hub_bill_rule_no_truncate() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'HUB_GUARD: bill rules are never deleted — switch a rule off instead.';
end $$;
revoke all on function public.hub_bill_rule_no_truncate() from public, anon, authenticated, service_role;

-- XB: read + add only (service_role named on purpose — it is the role that had too much)
do $$
declare t text;
begin
  foreach t in array array['wc_fetch_runs', 'wc_receipt_versions', 'wc_ref_searches', 'wc_receipt_seen', 'wc_links', 'wc_product_maps',
                           'wc_tolerances', 'wc_decisions', 'wc_reports', 'wc_report_items'] loop
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.wc_refuse_truncate()', t || '_no_truncate', t);
  end loop;
  -- a warehouse read is FINISHED once (its row guard refuses any other change)
  execute 'grant update on public.wc_fetch_runs to service_role';
  -- numbers / ids: the server only takes the next one
  foreach t in array array['wc_report_no_seq', 'wc_receipt_versions_id_seq', 'wc_report_items_id_seq', 'wc_ref_searches_id_seq', 'wc_receipt_seen_id_seq'] loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', t);
    execute format('grant usage on sequence public.%I to service_role', t);
  end loop;
end $$;
-- saving a numbered report (all items at once) stays the server's only way to write wc_reports / wc_report_items
revoke all on function public.wc_save_report(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.wc_save_report(jsonb, jsonb) to service_role;

-- WX: read, add, change; never delete
revoke all on public.bill_category_rules from public, anon, authenticated, service_role;
grant select, insert, update on public.bill_category_rules to service_role;
drop trigger if exists hub_bill_rule_no_truncate on public.bill_category_rules;
create trigger hub_bill_rule_no_truncate before truncate on public.bill_category_rules for each statement execute function public.hub_bill_rule_no_truncate();

commit;

-- check after running (read-only): 11 rows, every one "OK"
with t(table_name, expected) as (
  values ('bill_category_rules', 'SELECT, INSERT, UPDATE'),
         ('wc_decisions', 'SELECT, INSERT'), ('wc_fetch_runs', 'SELECT, INSERT, UPDATE'), ('wc_links', 'SELECT, INSERT'),
         ('wc_product_maps', 'SELECT, INSERT'), ('wc_receipt_seen', 'SELECT, INSERT'), ('wc_receipt_versions', 'SELECT, INSERT'),
         ('wc_ref_searches', 'SELECT, INSERT'), ('wc_report_items', 'SELECT, INSERT'), ('wc_reports', 'SELECT, INSERT'),
         ('wc_tolerances', 'SELECT, INSERT')
), p(ord, priv) as (
  values (1, 'SELECT'), (2, 'INSERT'), (3, 'UPDATE'), (4, 'DELETE'), (5, 'TRUNCATE'), (6, 'REFERENCES'), (7, 'TRIGGER')
), r as (
  select t.table_name, t.expected,
         coalesce((select string_agg(p.priv, ', ' order by p.ord) from p where has_table_privilege('service_role', 'public.' || t.table_name, p.priv)), 'none') as service_role_rights,
         exists (select 1 from p where has_table_privilege('anon', 'public.' || t.table_name, p.priv) or has_table_privilege('authenticated', 'public.' || t.table_name, p.priv)) as browser_any,
         exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.table_name)::regclass and not g.tgisinternal and (g.tgtype & 32) <> 0) as truncate_guard
  from t
)
select table_name, service_role_rights, expected as should_be,
       case when browser_any then 'HAS RIGHTS' else 'none' end as browser_rights,
       case when truncate_guard then 'yes' else 'NO' end as truncate_refused,
       case when service_role_rights = expected and not browser_any and truncate_guard then 'OK' else 'PROBLEM' end as result
from r
order by 1;
