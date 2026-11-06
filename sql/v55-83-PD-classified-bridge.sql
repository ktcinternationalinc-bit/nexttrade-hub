-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PD — CLASSIFIED-EXPENSE BRIDGE (hub matching → ClickBooks ledger)
--
-- Max (Nov 6): "The things that have already been matched in the old system
-- need to be pushed into the new system... make some sort of connection
-- between the two... that's very important."
--
-- The engine posts invoices, invoice payments, and RULE-matched untouched
-- bank transactions. What it never posted: bank transactions your team
-- already REVIEWED and CLASSIFIED in Bank Review. This bridge posts those,
-- through the engine's own post_journal (same source identity as the rule
-- path, so a transaction can only ever post ONCE, enforced in the database).
--
-- Discipline:
--   • Only classifications YOU have mapped to a ledger account AND marked
--     reviewed will post. Unmapped classifications are counted and reported,
--     never guessed.
--   • Same gates as shadow sync: certified history, parallel phase, posting
--     window after the opening cutoff, repeatable-read transaction.
--   • Matched/linked/pending transactions are excluded (payments already
--     flow through the payment path).
-- SAFE TO RE-RUN (create or replace; table if not exists).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists clickbooks_us.classification_account_map(
  classification text primary key,
  account_id uuid not null references clickbooks_us.accounts(id),
  reviewed boolean not null default false,
  evidence text,
  updated_at timestamptz not null default now()
);
revoke all on clickbooks_us.classification_account_map from public, anon, authenticated;

create or replace function clickbooks_us.classified_sync_run(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text;
  t record; bank_gl uuid; map_acct uuid; n bigint; lines jsonb;
  posted int := 0; already int := 0; no_bank_map int := 0;
  unmapped jsonb := '{}'::jsonb; cls_key text;
  result jsonb;
begin
  if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code='KTC_US' for update;
  select * into strict c from clickbooks_us.cutover_control where singleton for update;
  src := b.wave_business_id;
  if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
  if b.opening_cutoff is null or p_from <= b.opening_cutoff or p_from > p_to or p_to > current_date + 1 or p_to - p_from > 31 then raise exception 'CB_SHADOW_PERIOD'; end if;

  for t in
    select bt.* from public.bank_transactions bt
     where bt.wave_business_id = src
       and bt.pending is false
       and bt.iso_currency = 'USD'
       and bt.review_status = 'reviewed'
       and bt.classification is not null
       and bt.matched_invoice_id is null
       and bt.linked_id is null
       and coalesce(bt.posted_date, bt.date) between p_from and p_to
     order by coalesce(bt.posted_date, bt.date), bt.id
  loop
    -- once per transaction, ever — shared identity with the rule path
    if exists(select 1 from clickbooks_us.journals j where j.book_id = b.id and j.source_kind = 'bank_transaction' and j.source_id = t.id::text) then
      already := already + 1; continue;
    end if;
    cls_key := trim(t.classification);
    select m.account_id into map_acct
      from clickbooks_us.classification_account_map m
      join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = b.id
     where m.classification = cls_key and m.reviewed
       and a.is_active and not a.needs_review and not a.is_bank_sensitive;
    if map_acct is null then
      unmapped := jsonb_set(unmapped, array[cls_key], to_jsonb(coalesce((unmapped->>cls_key)::int, 0) + 1));
      continue;
    end if;
    select m.account_id into bank_gl
      from clickbooks_us.bank_ledger_map m
      join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = m.book_id
     where m.book_id = b.id and m.provider_account_id = t.account_id and m.reviewed
       and a.is_active and not a.needs_review and a.is_bank_sensitive;
    if bank_gl is null then no_bank_map := no_bank_map + 1; continue; end if;

    n := clickbooks_us.money_cents(t.amount_abs::text);
    if t.direction = 'out' then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', bank_gl,  'debit_cents', '0',     'credit_cents', n::text),
        jsonb_build_object('account_id', map_acct, 'debit_cents', n::text, 'credit_cents', '0'));
    elsif t.direction = 'in' then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', bank_gl,  'debit_cents', n::text, 'credit_cents', '0'),
        jsonb_build_object('account_id', map_acct, 'debit_cents', '0',     'credit_cents', n::text));
    else
      continue;
    end if;
    perform clickbooks_us.post_journal(b.id, coalesce(t.posted_date, t.date),
      'Classified bank transaction ' || t.id::text || ' (' || cls_key || ')',
      'bank_transaction', t.id::text, lines, p_actor);
    posted := posted + 1;
  end loop;

  result := jsonb_build_object('from', p_from, 'to', p_to,
    'classifiedPosted', posted, 'alreadyPosted', already,
    'skippedNoBankMap', no_bank_map, 'skippedUnmapped', unmapped);
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('classified_sync_completed', p_actor, result);
  return result;
end $$;

-- Service facade for the scheduler (same pattern as the shadow job wrapper)
create or replace function public.clickbooks_us_classified_sync_job(p_from date, p_to date, p_actor uuid) returns jsonb
language sql security definer set search_path='' as $$ select clickbooks_us.classified_sync_run(p_from, p_to, p_actor) $$;
revoke all on function public.clickbooks_us_classified_sync_job(date, date, uuid) from public, anon, authenticated;
grant execute on function public.clickbooks_us_classified_sync_job(date, date, uuid) to service_role;

-- VERIFICATION
select '1. classification_account_map' as check_name,
       case when to_regclass('clickbooks_us.classification_account_map') is not null then '✅ exists' else '❌ MISSING' end as result
union all
select '2. classified_sync_run',
       case when exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'clickbooks_us' and p.proname = 'classified_sync_run') then '✅ exists' else '❌ MISSING' end
union all
select '3. service job wrapper',
       case when exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'clickbooks_us_classified_sync_job') then '✅ exists' else '❌ MISSING' end;
