-- v55.83-YH — Canada historical archive (Max, 24 Nov 2026). Run ONCE in Supabase → SQL Editor. Safe to run again.
--
-- Max: "save this historical data on the canada side for historical purposes on the amounts of goods received for the
-- different types of goods ... correlate it to the current types of cgt goods ... create its own menu tab."
--
-- What it does: ADDS four new, empty tables only. Nothing existing is changed, nothing is deleted.
--   canada_history_batches          one row per load of the archive file (which workbook, who, when, how many lines)
--   canada_history_receipts         the old Cambridge "Scan In" sheet: goods received, by goods name, in pounds
--   canada_history_shipments        the old Cambridge "Scan Out" sheet: goods shipped per 1001- release, by goods name, in pounds
--   canada_history_goods_decisions  Max's decisions: which current CGT goods type an old Canadian goods name belongs to
-- An archive line can never be changed or deleted (a trigger refuses it). A decision is never edited: a newer row replaces it.
-- Only the server (service role) can read or write these tables; the browser cannot (RLS on, no policies, grants revoked).
-- These tables are separate from inventory, bills, invoices, bank lines and P&L: nothing reads them except the Canada History tab.

create table if not exists public.canada_history_batches (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  source_sha256 text,
  data_sha256 text not null,
  status text not null default 'loading' check (status in ('loading', 'complete')),
  loaded_by text,
  loaded_at timestamptz not null default now(),
  receipt_lines integer not null check (receipt_lines >= 0),
  shipment_lines integer not null check (shipment_lines >= 0)
);
-- the same file can be stored complete only once
create unique index if not exists canada_history_batches_one_complete on public.canada_history_batches (data_sha256) where status = 'complete';

create table if not exists public.canada_history_receipts (
  id bigserial primary key,
  batch_id uuid not null references public.canada_history_batches (id),
  source_row integer not null,                 -- the row on the workbook sheet, to trace a figure back
  entry_date date,                             -- one disposal line has no date in the workbook
  entry_kind text not null check (entry_kind in ('received', 'opening', 'conversion', 'adjustment', 'disposal')),
  cgt_reference text,
  nexpac_invoice text,
  goods_name text not null,                    -- the old Canadian goods name, exactly as the workbook column
  weight_lb numeric(14, 3) not null check (weight_lb <> 0),
  check (entry_kind <> 'received' or (weight_lb > 0 and entry_date is not null))
);
create index if not exists canada_history_receipts_batch on public.canada_history_receipts (batch_id, id);

create table if not exists public.canada_history_shipments (
  id bigserial primary key,
  batch_id uuid not null references public.canada_history_batches (id),
  source_row integer not null,
  ship_date date not null,                     -- the confirmed loading date
  order_date date,
  release_no text not null,
  nextrade_invoice text,
  customer text,
  goods_name text not null,
  weight_lb numeric(14, 3) not null check (weight_lb > 0)
);
create index if not exists canada_history_shipments_batch on public.canada_history_shipments (batch_id, id);

create table if not exists public.canada_history_goods_decisions (
  id bigserial primary key,
  goods_name text not null,
  cgt_type text not null default '',           -- '' = keep it unmatched, under its own old name
  decided_by text,
  decided_at timestamptz not null default now()
);
create index if not exists canada_history_goods_decisions_name on public.canada_history_goods_decisions (goods_name, decided_at desc);

create or replace function public.canada_history_refuse_change() returns trigger language plpgsql as $yh$
begin
  raise exception 'YH: % on % is refused — the Canada history is an archive, its lines are never changed or deleted', tg_op, tg_table_name;
end $yh$;

-- a load is marked complete once; nothing else on a batch may change, and a batch is never deleted
create or replace function public.canada_history_batch_finish_once() returns trigger language plpgsql as $yh$
begin
  if tg_op = 'UPDATE' and old.status = 'loading' and new.status = 'complete'
     and new.id = old.id and new.source_file = old.source_file and new.data_sha256 = old.data_sha256
     and new.source_sha256 is not distinct from old.source_sha256 and new.loaded_by is not distinct from old.loaded_by
     and new.loaded_at = old.loaded_at and new.receipt_lines = old.receipt_lines and new.shipment_lines = old.shipment_lines then
    return new;
  end if;
  raise exception 'YH: % on canada_history_batches is refused — a load is only marked complete once, never changed or deleted', tg_op;
end $yh$;

do $yh$
declare t text;
begin
  foreach t in array array['canada_history_batches', 'canada_history_receipts', 'canada_history_shipments', 'canada_history_goods_decisions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_change', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.%I()', t || '_no_change', t,
      case when t = 'canada_history_batches' then 'canada_history_batch_finish_once' else 'canada_history_refuse_change' end);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('revoke all on public.%I from service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
  end loop;
  execute 'grant update on public.canada_history_batches to service_role';
  execute 'revoke all on sequence public.canada_history_receipts_id_seq from public, anon, authenticated';
  execute 'revoke all on sequence public.canada_history_shipments_id_seq from public, anon, authenticated';
  execute 'revoke all on sequence public.canada_history_goods_decisions_id_seq from public, anon, authenticated';
  execute 'grant usage on sequence public.canada_history_receipts_id_seq to service_role';
  execute 'grant usage on sequence public.canada_history_shipments_id_seq to service_role';
  execute 'grant usage on sequence public.canada_history_goods_decisions_id_seq to service_role';
end $yh$;

-- VERIFICATION — every line should say OK.
select 'canada_history_batches' as item, case when to_regclass('public.canada_history_batches') is not null then 'OK' else 'MISSING' end as result
union all select 'canada_history_receipts', case when to_regclass('public.canada_history_receipts') is not null then 'OK' else 'MISSING' end
union all select 'canada_history_shipments', case when to_regclass('public.canada_history_shipments') is not null then 'OK' else 'MISSING' end
union all select 'canada_history_goods_decisions', case when to_regclass('public.canada_history_goods_decisions') is not null then 'OK' else 'MISSING' end
union all select 'browser cannot read (RLS on, 4 tables)', case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'canada\_history\_%' and c.relkind = 'r' and c.relrowsecurity) = 4 then 'OK' else 'MISSING' end
union all select 'no-change triggers (4)', case when (select count(*) from pg_trigger where tgname like 'canada\_history\_%\_no\_change' and not tgisinternal) = 4 then 'OK' else 'MISSING' end;
