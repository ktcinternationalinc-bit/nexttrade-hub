-- v55.83-XB — Bill-to-Warehouse weight check (Max, 21 Nov 2026). Run ONCE in Supabase → SQL Editor. Safe to run again.
--
-- What it does: ADDS new tables only (nothing existing is changed, nothing is deleted).
--   wc_fetch_runs        each read of the warehouse (who, when, ok / failed, complete or not)
--   wc_receipt_versions  the Hub's own dated copy of each warehouse receipt; a new version only when it changed (never edited)
--   wc_ref_searches      each reference looked for in the warehouse and how many receipts carried it
--   wc_links             bill ↔ receipt links a person confirmed or rejected (never edited; a newer row replaces an older one)
--   wc_product_maps      approved "this bill product = that warehouse product" rules, versioned (never edited)
--   wc_tolerances        the tolerance Max approves, versioned (none until he saves one)
--   wc_decisions         every Validate / Accept / Report issue / Resolve / Reopen with its snapshot (never edited)
--   wc_reports + wc_report_items   saved numbered reports WC-YYYY-NNNN, frozen as they stood (never edited)
-- Rows in these tables can never be changed or deleted (a trigger refuses it) except finishing a fetch run.
-- Only the server (service role) can read or write them; the browser cannot (RLS on, no policies, grants revoked).

create table if not exists public.wc_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('recheck', 'report', 'bill_open')),
  triggered_by uuid,
  source text not null,
  site text,
  feed_generated_at timestamptz,
  ok boolean,
  complete boolean,
  error text,
  counts jsonb not null default '{}'::jsonb,
  lookups jsonb
);
create index if not exists wc_fetch_runs_started on public.wc_fetch_runs (started_at desc);

create table if not exists public.wc_receipt_versions (
  id bigserial primary key,
  source text not null,
  receipt_id text not null,
  version_no integer not null check (version_no >= 1),
  content_hash text not null,
  state text not null check (state in ('present', 'removed')),
  data jsonb,
  fetched_at timestamptz not null default now(),
  fetch_run_id uuid references public.wc_fetch_runs (id),
  refs text[] not null default '{}',   -- the receipt's references, normalised (case, spaces, # . - / _ removed), for look-ups
  unique (source, receipt_id, version_no)
);
create index if not exists wc_receipt_versions_refs on public.wc_receipt_versions using gin (refs);
create index if not exists wc_receipt_versions_lookup on public.wc_receipt_versions (source, receipt_id, version_no desc);

-- each reference the Hub looked for in the warehouse, and how many receipts carried it (so 'No receipt found' is only said after a real search)
create table if not exists public.wc_ref_searches (
  id bigserial primary key,
  fetch_run_id uuid not null references public.wc_fetch_runs (id),
  source text not null,
  ref_norm text not null,
  found integer not null check (found >= 0),
  at timestamptz not null default now()
);
create index if not exists wc_ref_searches_ref on public.wc_ref_searches (source, ref_norm, at desc);

create table if not exists public.wc_links (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.vendor_bills (id),
  source text not null,
  receipt_id text not null,
  basis text not null check (basis in ('cgt_reference', 'reference_number', 'nexpac_bill', 'container', 'manual')),
  bill_value text,
  receipt_value text,
  state text not null check (state in ('confirmed', 'rejected')),
  reason text,
  actor uuid not null,
  at timestamptz not null default now()
);
create index if not exists wc_links_bill on public.wc_links (bill_id, at);
create index if not exists wc_links_receipt on public.wc_links (source, receipt_id);

create table if not exists public.wc_product_maps (
  id uuid primary key default gen_random_uuid(),
  family uuid not null,                 -- the same rule across its versions
  version integer not null check (version >= 1),
  state text not null check (state in ('active', 'retired')),
  vendor_key text not null,
  item_key text not null,
  bill_unit text not null default '',
  bill_description text,
  wh_product_type text, wh_cgt text, wh_nt text, wh_color text,
  wh_label text,
  lb_per_yd numeric check (lb_per_yd is null or lb_per_yd > 0),
  lb_factor_approved boolean not null default false,
  note text,
  actor uuid not null,
  at timestamptz not null default now(),
  unique (family, version),
  check (coalesce(wh_product_type, wh_cgt, wh_nt, wh_color) is not null)
);
create index if not exists wc_product_maps_key on public.wc_product_maps (vendor_key, item_key, bill_unit);

create table if not exists public.wc_tolerances (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  pct numeric check (pct is null or (pct >= 0 and pct <= 100)),
  lb numeric check (lb is null or lb >= 0),
  note text,
  actor uuid not null,
  at timestamptz not null default now(),
  check (pct is not null or lb is not null)
);

create table if not exists public.wc_decisions (
  id uuid primary key default gen_random_uuid(),
  item_key text not null,
  kind text not null check (kind in ('validate_match', 'accept_discrepancy', 'report_issue', 'resolve', 'reopen')),
  reason text not null check (length(btrim(reason)) >= 5),
  evidence jsonb not null default '[]'::jsonb,
  assignee uuid,
  ticket_id uuid,
  actor uuid not null,
  at timestamptz not null default now(),
  comparison_fp text,
  evidence_hash text not null,
  snapshot jsonb not null,
  outcome text,
  bill_ids uuid[] not null default '{}'
);
create index if not exists wc_decisions_item on public.wc_decisions (item_key, at);
create index if not exists wc_decisions_bills on public.wc_decisions using gin (bill_ids);

create sequence if not exists public.wc_report_no_seq;
create table if not exists public.wc_reports (
  id uuid primary key default gen_random_uuid(),
  report_no text not null unique,
  run_by uuid not null,
  run_at timestamptz not null default now(),
  date_from date,
  date_to date,
  filters jsonb not null default '{}'::jsonb,
  source text,
  fetch_run_id uuid references public.wc_fetch_runs (id),
  feed_generated_at timestamptz,
  bills_checked jsonb not null default '[]'::jsonb,
  references_checked jsonb not null default '[]'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  status_at_run text not null,
  build text
);
create index if not exists wc_reports_run_at on public.wc_reports (run_at desc);
create table if not exists public.wc_report_items (
  id bigserial primary key,
  report_id uuid not null references public.wc_reports (id),
  seq integer not null,
  item_key text not null,
  bill_ids uuid[] not null default '{}',
  bill_dates date[] not null default '{}',
  outcome text not null,
  state text not null,
  needs_attention boolean not null,   -- counts toward the report being complete (not checked / blocked items count too)
  row jsonb not null,
  comparison_fp text,
  evidence_hash text,
  decision_id uuid,
  unique (report_id, seq)
);
create index if not exists wc_report_items_report on public.wc_report_items (report_id, seq);

-- never changed, never deleted (Max: never delete data). A fetch run may only be FINISHED once.
create or replace function public.wc_refuse_change() returns trigger language plpgsql as $$
begin
  raise exception 'XB: % on % is refused — weight-check records are never changed or deleted', tg_op, tg_table_name;
end $$;
create or replace function public.wc_fetch_run_finish_once() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.finished_at is null
     and new.id = old.id and new.started_at = old.started_at and new.trigger = old.trigger and new.source = old.source
     and new.triggered_by is not distinct from old.triggered_by then
    return new;
  end if;
  raise exception 'XB: % on wc_fetch_runs is refused — a fetch run is only finished once, never changed or deleted', tg_op;
end $$;
do $$
declare t text;
begin
  foreach t in array array['wc_fetch_runs', 'wc_receipt_versions', 'wc_ref_searches', 'wc_links', 'wc_product_maps', 'wc_tolerances', 'wc_decisions', 'wc_reports', 'wc_report_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_change', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.%I()', t || '_no_change', t,
      case when t = 'wc_fetch_runs' then 'wc_fetch_run_finish_once' else 'wc_refuse_change' end);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert on public.%I to service_role', t);
  end loop;
  execute 'grant update on public.wc_fetch_runs to service_role';
  execute 'revoke all on sequence public.wc_report_no_seq from public, anon, authenticated';
  execute 'grant usage on sequence public.wc_report_no_seq to service_role';
  execute 'grant usage on sequence public.wc_receipt_versions_id_seq to service_role';
  execute 'grant usage on sequence public.wc_report_items_id_seq to service_role';
  execute 'grant usage on sequence public.wc_ref_searches_id_seq to service_role';
end $$;

-- save a report and all its items in ONE transaction (all or nothing), with the next number WC-YYYY-NNNN
create or replace function public.wc_save_report(p_report jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no text; v_n integer := 0; it jsonb;
begin
  if p_report is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'XB: report and items are required'; end if;
  v_no := 'WC-' || to_char(now() at time zone 'America/New_York', 'YYYY') || '-' || lpad(nextval('public.wc_report_no_seq')::text, 4, '0');
  insert into public.wc_reports (report_no, run_by, date_from, date_to, filters, source, fetch_run_id, feed_generated_at, bills_checked, references_checked, counts, status_at_run, build)
  values (v_no, (p_report->>'run_by')::uuid, nullif(p_report->>'date_from', '')::date, nullif(p_report->>'date_to', '')::date, coalesce(p_report->'filters', '{}'::jsonb),
          p_report->>'source', nullif(p_report->>'fetch_run_id', '')::uuid, nullif(p_report->>'feed_generated_at', '')::timestamptz,
          coalesce(p_report->'bills_checked', '[]'::jsonb), coalesce(p_report->'references_checked', '[]'::jsonb), coalesce(p_report->'counts', '{}'::jsonb),
          p_report->>'status_at_run', p_report->>'build')
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    insert into public.wc_report_items (report_id, seq, item_key, bill_ids, bill_dates, outcome, state, needs_attention, row, comparison_fp, evidence_hash, decision_id)
    values (v_id, v_n, it->>'item_key',
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(it->'bill_ids', '[]'::jsonb)) x), '{}'),
            coalesce((select array_agg(x::date) from jsonb_array_elements_text(coalesce(it->'bill_dates', '[]'::jsonb)) x where x <> ''), '{}'),
            it->>'outcome', it->>'state', coalesce((it->>'needs_attention')::boolean, false), it->'row', it->>'comparison_fp', it->>'evidence_hash', nullif(it->>'decision_id', '')::uuid);
  end loop;
  return jsonb_build_object('id', v_id, 'report_no', v_no, 'items', v_n);
end $$;
revoke all on function public.wc_save_report(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.wc_save_report(jsonb, jsonb) to service_role;

-- check after running: should list 9 tables, each with RLS on
select c.relname as table_name, c.relrowsecurity as rls_on from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'wc\_%' and c.relkind = 'r' order by 1;
