-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- v55.83-SO — CONFIRMED DUPLICATES LEAVE THE BOOKS (and can come back)
-- Max, Nov 15 2026: "Confirmed duplicates must disappear from normal screens and be excluded
--   consistently from active calculations, balances, aggregations, dashboards, exports, and reports.
--   Preserve the original record and an audit trail, with an option to restore it. Simply hiding a
--   row is insufficient."
--
-- HOW: a confirmed duplicate is MOVED out of bank_transactions into bank_transaction_duplicates,
-- whole (every column, as JSON), in one transaction. Because it is no longer in bank_transactions,
-- every screen, total, export and report — and the ledger's own drift check, which reverses the
-- entry of a bank line that is "no longer in the hub" — stops counting it without any of them
-- needing to know. Restore puts the exact row back.
--
-- SAFE TO RE-RUN. Nothing is deleted by running this file.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.bank_transaction_duplicates (
  seq                  bigserial primary key,       -- one record per removal (a row restored and removed again gets a new one)
  id                   uuid not null,               -- the ORIGINAL bank_transactions.id
  plaid_transaction_id text,
  kept_id              uuid,                        -- the transaction that was kept (null = removed without a named twin)
  wave_business_id     text,
  account_id           text,
  tx_date              date,
  direction            text,
  amount_abs           numeric(14,2),
  row_data             jsonb not null,              -- the whole original row
  reason               text,
  status               text not null default 'removed' check (status in ('removed','restored')),
  removed_by           uuid,
  removed_at           timestamptz not null default now(),
  restored_by          uuid,
  restored_at          timestamptz
);
create unique index if not exists ux_bank_dup_live on public.bank_transaction_duplicates(id) where status = 'removed';
create index if not exists ix_bank_dup_plaid on public.bank_transaction_duplicates(plaid_transaction_id) where status = 'removed';
create index if not exists ix_bank_dup_status on public.bank_transaction_duplicates(status, removed_at desc);

create table if not exists public.bank_duplicate_dismissals (
  pair_key     text primary key,                    -- the two transaction ids, sorted, joined with '|'
  a_id         uuid not null,
  b_id         uuid not null,
  note         text,
  dismissed_by uuid,
  dismissed_at timestamptz not null default now()
);

alter table public.bank_transaction_duplicates enable row level security;
alter table public.bank_duplicate_dismissals  enable row level security;
-- Read-only for signed-in users; every write goes through the server (service role) and the
-- functions below, so a browser can never add, change or erase a record of what was removed.
drop policy if exists bank_dup_select on public.bank_transaction_duplicates;
create policy bank_dup_select on public.bank_transaction_duplicates for select to authenticated using (true);
drop policy if exists bank_dup_dismiss_select on public.bank_duplicate_dismissals;
create policy bank_dup_dismiss_select on public.bank_duplicate_dismissals for select to authenticated using (true);

-- The record of a removal is permanent: only its status may move removed <-> restored.
create or replace function public.bank_duplicate_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'A removed-duplicate record cannot be erased.'; end if;
  if old.status = 'restored' then raise exception 'A restored record is history and cannot change.'; end if;
  if new.id is distinct from old.id or new.seq is distinct from old.seq or new.kept_id is distinct from old.kept_id or new.row_data is distinct from old.row_data
     or new.removed_by is distinct from old.removed_by or new.removed_at is distinct from old.removed_at then
    raise exception 'A removed-duplicate record cannot be rewritten.';
  end if;
  return new;
end $$;
drop trigger if exists bank_duplicate_guard_t on public.bank_transaction_duplicates;
create trigger bank_duplicate_guard_t before update or delete on public.bank_transaction_duplicates
  for each row execute function public.bank_duplicate_guard();

-- ── remove: move one confirmed duplicate out of the books ─────────────────────────────────────
create or replace function public.bank_duplicate_remove(p_dup uuid, p_keep uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.bank_transactions%rowtype;
  k public.bank_transactions%rowtype;
  dj jsonb; kj jsonb;
  hit boolean;
  lock_through date;
  d_date date;
begin
  if p_dup is null then return jsonb_build_object('ok', false, 'why', 'No transaction was given.'); end if;
  if p_keep is not null and p_keep = p_dup then return jsonb_build_object('ok', false, 'why', 'The transaction to keep and the one to remove are the same.'); end if;

  select * into d from public.bank_transactions where id = p_dup for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'That transaction is not in the books (it may already have been removed).'); end if;
  dj := to_jsonb(d);
  d_date := coalesce(nullif(dj->>'posted_date','')::date, nullif(dj->>'date','')::date);

  if p_keep is not null then
    select * into k from public.bank_transactions where id = p_keep for update;
    if not found then return jsonb_build_object('ok', false, 'why', 'The transaction to keep was not found.'); end if;
    kj := to_jsonb(k);
    -- Money is never matched loosely: the two must be the same amount, direction and currency.
    if round(abs(coalesce((dj->>'amount_abs')::numeric, abs((dj->>'amount')::numeric), 0)) * 100)
       <> round(abs(coalesce((kj->>'amount_abs')::numeric, abs((kj->>'amount')::numeric), 0)) * 100) then
      return jsonb_build_object('ok', false, 'why', 'The two amounts differ, so they are not the same bank line.');
    end if;
    if coalesce(dj->>'direction','') <> coalesce(kj->>'direction','') then
      return jsonb_build_object('ok', false, 'why', 'One is money in and the other is money out — those are the two sides of a transfer, not a duplicate.');
    end if;
    if coalesce(nullif(dj->>'iso_currency',''), 'USD') <> coalesce(nullif(kj->>'iso_currency',''), 'USD') then
      return jsonb_build_object('ok', false, 'why', 'The two are in different currencies.');
    end if;
    if coalesce(dj->>'wave_business_id','') <> coalesce(kj->>'wave_business_id','') then
      return jsonb_build_object('ok', false, 'why', 'The two belong to different companies.');
    end if;
  end if;

  -- A transaction that carries accounting work is never the one removed. Keep that one instead,
  -- or undo the work first.
  if nullif(dj->>'matched_invoice_id','') is not null then
    return jsonb_build_object('ok', false, 'why', 'This transaction is matched to an invoice. Keep this one instead, or unmatch it first.', 'blocked_by', 'invoice match');
  end if;
  if nullif(dj->>'transfer_group_id','') is not null then
    return jsonb_build_object('ok', false, 'why', 'This transaction is linked as one side of a transfer. Keep this one instead, or unlink the transfer first.', 'blocked_by', 'transfer');
  end if;
  if nullif(dj->>'linked_id','') is not null then
    return jsonb_build_object('ok', false, 'why', 'This transaction is linked to another record. Keep this one instead, or unlink it first.', 'blocked_by', 'link');
  end if;

  if to_regclass('public.payment_matches') is not null then
    execute 'select exists(select 1 from public.payment_matches m where m.bank_transaction_id = $1 and m.voided is not true)' into hit using p_dup;
    if hit then return jsonb_build_object('ok', false, 'why', 'This transaction has a payment match. Keep this one instead, or unmatch it first.', 'blocked_by', 'payment match'); end if;
  end if;
  if to_regclass('public.accounting_invoice_payments') is not null then
    execute 'select exists(select 1 from public.accounting_invoice_payments p where p.bank_transaction_id = $1 and p.voided is not true)' into hit using p_dup;
    if hit then return jsonb_build_object('ok', false, 'why', 'An invoice payment was recorded from this transaction. Keep this one instead, or void that payment first.', 'blocked_by', 'invoice payment'); end if;
  end if;
  if to_regclass('public.bank_transaction_splits') is not null then
    execute 'select exists(select 1 from public.bank_transaction_splits s where s.bank_transaction_id = $1)' into hit using p_dup;
    if hit then return jsonb_build_object('ok', false, 'why', 'This transaction is split into lines. Keep this one instead, or remove its split first.', 'blocked_by', 'split'); end if;
  end if;
  if to_regclass('public.unapplied_deposits') is not null then
    execute 'select exists(select 1 from public.unapplied_deposits u where u.bank_transaction_id = $1 and (u.status is null or u.status = ''open''))' into hit using p_dup;
    if hit then return jsonb_build_object('ok', false, 'why', 'This deposit is being held as unapplied money. Keep this one instead.', 'blocked_by', 'unapplied deposit'); end if;
  end if;
  if to_regclass('public.customer_credits') is not null then
    execute 'select exists(select 1 from public.customer_credits c where c.source_transaction_id = $1 and (c.status is null or c.status = ''open''))' into hit using p_dup;
    if hit then return jsonb_build_object('ok', false, 'why', 'A customer credit was created from this transaction. Keep this one instead.', 'blocked_by', 'customer credit'); end if;
  end if;
  if to_regclass('public.vendor_bill_payments') is not null then
    execute 'select exists(select 1 from public.vendor_bill_payments p where p.bank_transaction_id = $1 and p.voided is not true)' into hit using p_dup;
    if hit then return jsonb_build_object('ok', false, 'why', 'A bill was paid from this transaction. Keep this one instead, or void that bill payment first.', 'blocked_by', 'bill payment'); end if;
  end if;
  if to_regclass('public.wire_packages') is not null then
    execute 'select exists(select 1 from public.wire_packages w where w.bank_transaction_id = $1 and w.status <> ''cancelled'')' into hit using p_dup;
    if hit then return jsonb_build_object('ok', false, 'why', 'A wire is attached to this transaction. Keep this one instead.', 'blocked_by', 'wire'); end if;
  end if;

  -- A closed month is closed: its bank lines do not change until the month is reopened.
  if to_regclass('clickbooks_us.books') is not null and d_date is not null then
    execute 'select locked_through from clickbooks_us.books where code = ''KTC_US''' into lock_through;
    if lock_through is not null and d_date <= lock_through then
      return jsonb_build_object('ok', false, 'why', 'This transaction is dated ' || d_date || ', inside a closed month (books are closed through ' || lock_through || '). Reopen the month first (Accounting → Month-end).', 'blocked_by', 'closed month');
    end if;
  end if;

  insert into public.bank_transaction_duplicates(id, plaid_transaction_id, kept_id, wave_business_id, account_id, tx_date, direction, amount_abs, row_data, reason, status, removed_by)
  values (p_dup, nullif(dj->>'plaid_transaction_id',''), p_keep, dj->>'wave_business_id', dj->>'account_id', d_date, dj->>'direction',
          round(abs(coalesce((dj->>'amount_abs')::numeric, abs((dj->>'amount')::numeric), 0)), 2), dj, left(coalesce(p_reason, ''), 500), 'removed', p_actor);

  delete from public.bank_transactions where id = p_dup;

  return jsonb_build_object('ok', true, 'removed', p_dup, 'kept', p_keep, 'date', d_date,
                            'amount', round(abs(coalesce((dj->>'amount_abs')::numeric, abs((dj->>'amount')::numeric), 0)), 2));
end $$;

-- ── restore: put a removed transaction back exactly as it was ─────────────────────────────────
create or replace function public.bank_duplicate_restore(p_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.bank_transaction_duplicates%rowtype;
begin
  select * into a from public.bank_transaction_duplicates where id = p_id and status = 'removed' for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'That transaction is not in the removed list (it may already have been restored).'); end if;
  if exists(select 1 from public.bank_transactions t where t.id = p_id) then
    return jsonb_build_object('ok', false, 'why', 'A transaction with that id is already in the books.');
  end if;
  if a.plaid_transaction_id is not null and exists(select 1 from public.bank_transactions t where t.plaid_transaction_id = a.plaid_transaction_id) then
    return jsonb_build_object('ok', false, 'why', 'The bank has since sent this same line again and it is already in the books.');
  end if;
  -- status first, so the tombstone below lets the row back in
  update public.bank_transaction_duplicates set status = 'restored', restored_by = p_actor, restored_at = now() where seq = a.seq;
  insert into public.bank_transactions select * from jsonb_populate_record(null::public.bank_transactions, a.row_data);
  return jsonb_build_object('ok', true, 'restored', p_id, 'date', a.tx_date, 'amount', a.amount_abs);
end $$;

-- ── tombstone: a removed duplicate does not creep back in on the next bank sync or import ─────
create or replace function public.bank_duplicate_tombstone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if exists(select 1 from public.bank_transaction_duplicates x
               where x.status = 'removed'
                 and (x.id = new.id or (new.plaid_transaction_id is not null and x.plaid_transaction_id = new.plaid_transaction_id))) then
      return null;   -- skip this one row; everything else in the same import carries on
    end if;
  exception when others then
    return new;      -- never let this check block the bank feed
  end;
  return new;
end $$;
drop trigger if exists bank_duplicate_tombstone_t on public.bank_transactions;
create trigger bank_duplicate_tombstone_t before insert on public.bank_transactions
  for each row execute function public.bank_duplicate_tombstone();

revoke all on function public.bank_duplicate_remove(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bank_duplicate_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bank_duplicate_remove(uuid, uuid, uuid, text) to service_role;
grant execute on function public.bank_duplicate_restore(uuid, uuid) to service_role;

select 'SO duplicates: archive + remove/restore + tombstone installed' as result,
       (select count(*) from public.bank_transaction_duplicates where status = 'removed') as removed_now;
