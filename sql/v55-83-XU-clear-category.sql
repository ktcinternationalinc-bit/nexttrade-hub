-- v55.83-XU — "Remove category" on ONE KTC bank line, done in ONE guarded step (Codex 22 Nov 18:08 P2 + 17:49):
--   • the line is locked; it must still be EXACTLY as the person saw it (category, source, verified, review, Wave and sync
--     status, pairing, invoice match, pending, account, company, dates) — else 'changed', nothing written;
--   • every money association is checked again HERE, at the moment of saving: ClickBooks ledger, closed month, Wave, invoice
--     payments, bill payments, saved splits, held money (open unapplied deposits / customer credits), payment matches, wires,
--     company-funds entries / funding transfers / reconciliations / Nextrade bill links, manual bank adjustments, order deposit
--     links, treasury matches — any one → refused with its own code, nothing written;
--   • the change and its audit row (exact before / after) are written together or not at all;
--   • nothing is deleted; no association is touched.
-- Re-runnable. Server only (service_role).
create or replace function public.hub_bank_clear_category(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_actor uuid;
  e jsonb := coalesce(p->'expect', '{}'::jsonb);
  t public.bank_transactions%rowtype;
  v_lock date;
  v_day date;
  v_before jsonb;
  v_after jsonb;
begin
  begin v_id := (p->>'id')::uuid; exception when others then return jsonb_build_object('ok', false, 'code', 'missing'); end;
  begin v_actor := nullif(p->>'actor', '')::uuid; exception when others then v_actor := null; end;
  if v_actor is null then return jsonb_build_object('ok', false, 'code', 'no_actor'); end if;

  select * into t from public.bank_transactions where id = v_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;
  if t.wave_business_id is distinct from (p->>'business') then return jsonb_build_object('ok', false, 'code', 'restricted'); end if;

  -- the line must still be exactly as it was read (null-safe)
  if t.classification is distinct from (e->>'classification')
     or t.category_source is distinct from (e->>'category_source')
     or t.category_verified::text is distinct from (e->>'category_verified')
     or t.review_status is distinct from (e->>'review_status')
     or t.wave_account_id is distinct from (e->>'wave_account_id')
     or t.category_status is distinct from (e->>'category_status')
     or t.wave_sync_status is distinct from (e->>'wave_sync_status')
     or t.sync_status is distinct from (e->>'sync_status')
     or t.transfer_group_id::text is distinct from (e->>'transfer_group_id')
     or t.matched_invoice_id::text is distinct from (e->>'matched_invoice_id')
     or t.pending::text is distinct from (e->>'pending')
     or t.account_id is distinct from (e->>'account_id')
     or t.date::text is distinct from (e->>'date')
     or t.posted_date::text is distinct from (e->>'posted_date')
  then return jsonb_build_object('ok', false, 'code', 'changed'); end if;

  if t.classification is null then return jsonb_build_object('ok', false, 'code', 'blank'); end if;
  if exists (select 1 from public.hub_bank_ledger_posted(array[v_id::text])) then return jsonb_build_object('ok', false, 'code', 'ledger'); end if;
  if t.category_status in ('synced', 'syncing') or t.wave_sync_status in ('synced', 'syncing') or t.sync_status in ('synced', 'syncing') then return jsonb_build_object('ok', false, 'code', 'wave'); end if;
  select max(b.locked_through) into v_lock from clickbooks_us.books b;
  v_day := coalesce(t.posted_date, t.date);
  if v_lock is not null and v_day is not null and v_day <= v_lock then return jsonb_build_object('ok', false, 'code', 'closed', 'through', v_lock); end if;
  if t.transfer_group_id is not null then return jsonb_build_object('ok', false, 'code', 'transfer'); end if;
  if t.matched_invoice_id is not null
     or exists (select 1 from public.accounting_invoice_payments x where x.bank_transaction_id = v_id and x.voided is not true)
  then return jsonb_build_object('ok', false, 'code', 'invoice'); end if;
  if exists (select 1 from public.payment_matches x where x.bank_transaction_id = v_id and x.voided is not true) then return jsonb_build_object('ok', false, 'code', 'match'); end if;
  if exists (select 1 from public.vendor_bill_payments x where x.bank_transaction_id = v_id and x.voided is not true) then return jsonb_build_object('ok', false, 'code', 'bill'); end if;
  if exists (select 1 from public.bank_transaction_splits x where x.bank_transaction_id = v_id) then return jsonb_build_object('ok', false, 'code', 'split'); end if;
  if exists (select 1 from public.unapplied_deposits x where x.bank_transaction_id = v_id and (x.status is null or x.status = 'open'))
     or exists (select 1 from public.customer_credits x where x.source_transaction_id = v_id and (x.status is null or x.status = 'open'))
  then return jsonb_build_object('ok', false, 'code', 'held'); end if;
  if exists (select 1 from public.wire_packages x where (x.bank_transaction_id = v_id or x.funding_txn_id = v_id) and x.reversed_at is null and coalesce(x.status, '') not in ('cancelled', 'reversed'))
  then return jsonb_build_object('ok', false, 'code', 'wire'); end if;
  if exists (select 1 from public.party_money_entries x where x.bank_transaction_id = v_id or x.source_bank_transaction_id = v_id)
     or exists (select 1 from public.party_funding_transfers x where x.bank_transaction_id = v_id)
     or exists (select 1 from public.party_reconciliations x where x.bank_transaction_id = v_id)
     or exists (select 1 from public.company_bill_links x where x.source_bank_transaction_id = v_id and x.status = 'active')
  then return jsonb_build_object('ok', false, 'code', 'funds'); end if;
  if exists (select 1 from clickbooks_us.manual_bank_adjustments x where x.bank_transaction_id = v_id and x.reversed_at is null) then return jsonb_build_object('ok', false, 'code', 'adjustment'); end if;
  if exists (select 1 from public.order_deposit_links x where x.bank_transaction_id = v_id and x.voided is not true) then return jsonb_build_object('ok', false, 'code', 'order'); end if;
  if exists (select 1 from public.treasury x where x.matched_bank_txn_id = v_id) then return jsonb_build_object('ok', false, 'code', 'treasury'); end if;
  if t.category_verified is true then return jsonb_build_object('ok', false, 'code', 'verified'); end if;
  if t.pending is true then return jsonb_build_object('ok', false, 'code', 'pending'); end if;
  if t.review_status = 'duplicate' then return jsonb_build_object('ok', false, 'code', 'duplicate'); end if;

  v_before := jsonb_build_object('classification', t.classification, 'category_source', t.category_source, 'review_status', t.review_status,
    'reviewed_by', t.reviewed_by, 'reviewed_at', t.reviewed_at, 'wave_account_id', t.wave_account_id, 'wave_account_name', t.wave_account_name,
    'category_status', t.category_status);
  update public.bank_transactions
     set classification = null, category_source = 'cleared', wave_account_id = null, wave_account_name = null, category_status = 'local_only',
         review_status = case when t.review_status in ('reviewed', 'approved') then 'unreviewed' else t.review_status end,
         reviewed_by = case when t.review_status in ('reviewed', 'approved') then null else t.reviewed_by end,
         reviewed_at = case when t.review_status in ('reviewed', 'approved') then null else t.reviewed_at end
   where id = v_id;
  v_after := jsonb_build_object('classification', null, 'category_source', 'cleared', 'review_status', case when t.review_status in ('reviewed', 'approved') then 'unreviewed' else t.review_status end,
    'wave_account_id', null, 'wave_account_name', null, 'category_status', 'local_only');
  insert into public.hub_audit_log (actor_id, action, entity, entity_id, details)
  values (v_actor, 'category_removed', 'bank_transaction', v_id::text,
    jsonb_build_object('before', v_before, 'after', v_after, 'who', left(coalesce(t.merchant_name, t.name, ''), 80), 'date', v_day, 'amount', t.amount_abs));
  return jsonb_build_object('ok', true, 'code', 'cleared', 'before', v_before);
end $$;
revoke all on function public.hub_bank_clear_category(jsonb) from public;
revoke all on function public.hub_bank_clear_category(jsonb) from anon;
revoke all on function public.hub_bank_clear_category(jsonb) from authenticated;
grant execute on function public.hub_bank_clear_category(jsonb) to service_role;

select 'hub_bank_clear_category installed' as check_item,
  case when to_regprocedure('public.hub_bank_clear_category(jsonb)') is not null then 'OK' else 'PROBLEM' end as result
union all
select 'browser roles cannot run it',
  case when not has_function_privilege('anon', 'public.hub_bank_clear_category(jsonb)', 'execute')
        and not has_function_privilege('authenticated', 'public.hub_bank_clear_category(jsonb)', 'execute') then 'OK' else 'PROBLEM' end
union all
select 'ledger check it relies on is installed',
  case when to_regprocedure('public.hub_bank_ledger_posted(text[])') is not null then 'OK' else 'PROBLEM - run sql/v55-83-WS-ledger-posted-check.sql first' end;
