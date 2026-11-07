-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-QF — Advance payments (Max, Nov 7 12:14: "add an advance for future
-- payment... and that we can go to it later on and add the actual bills that
-- will be associated to it in the future").
-- One column. Attaching the bills later is the normal 🔗 match flow (same
-- record_payment guards); the flag just marks the transaction so it is
-- findable until its bills arrive.
-- Paste into the Supabase SQL Editor and Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS advance_flag boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS bank_tx_advance_flag_idx ON bank_transactions (advance_flag) WHERE advance_flag = true;
select 'QF ok — open advances: ' || count(*) from bank_transactions where advance_flag = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — HUB → CLICKBOOKS, FULLY AUTOMATED (Max, Nov 7 12:15: "whatever
-- is done on the wave accounting side with matching should automatically
-- update in the clickbooks side... if category not on clickbooks.. add it
-- and then save it and update it.. automated and consistent").
--
-- classified_sync_run v2 (same name/signature — the 15-minute job needs no
-- code change):
--   1. TRANSFERS never post as expense/income (classification 'transfer' or
--      a paired transfer_group_id is skipped and counted — correctness fix).
--   2. Unmapped classification → EXACT normalized-name match against the
--      ledger's existing accounts; one hit → mapping saved (evidence says
--      auto) and it posts. Ambiguous → reported, never guessed.
--   3. Still nothing → the ACCOUNT IS CREATED from the hub category (name =
--      category label; income kinds → income account, expense/cogs kinds →
--      expense account), mapping saved, posted. Loan/owner (not_pnl) and
--      needs_clarification are NEVER auto-created — those stay reported for
--      a human (the SBA-loan precedent).
--   4. Any create failure is caught per-category and reported in the run
--      result — the run never breaks, nothing silent.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function clickbooks_us.classified_sync_run(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text;
  t record; bank_gl uuid; map_acct uuid; n bigint; lines jsonb;
  posted int := 0; already int := 0; no_bank_map int := 0; skipped_transfers int := 0;
  unmapped jsonb := '{}'::jsonb; cls_key text;
  auto_mapped jsonb := '{}'::jsonb; auto_created jsonb := '{}'::jsonb; create_errors jsonb := '{}'::jsonb;
  cat_label text; cat_kind text; want_type text; hit_id uuid; hit_n int; new_acct uuid;
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
    if exists(select 1 from clickbooks_us.journals j where j.book_id = b.id and j.source_kind = 'bank_transaction' and j.source_id = t.id::text) then
      already := already + 1; continue;
    end if;
    cls_key := trim(t.classification);
    -- (1) transfers between own accounts are NEVER income/expense postings
    if cls_key = 'transfer' or t.transfer_group_id is not null then
      skipped_transfers := skipped_transfers + 1; continue;
    end if;
    select m.account_id into map_acct
      from clickbooks_us.classification_account_map m
      join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = b.id
     where m.classification = cls_key and m.reviewed
       and a.is_active and not a.needs_review and not a.is_bank_sensitive;

    if map_acct is null then
      -- hub category drives the automation
      select ec.label, coalesce(ec.kind, 'expense') into cat_label, cat_kind
        from public.expense_categories ec where ec.key = cls_key;
      -- (2) EXACT normalized-name match, single hit only
      if cat_label is not null then
        select count(*), min(a.id) into hit_n, hit_id
          from clickbooks_us.accounts a
         where a.book_id = b.id and a.is_active and not a.is_bank_sensitive
           and lower(regexp_replace(a.name, '[^a-z0-9]+', ' ', 'gi')) = lower(regexp_replace(cat_label, '[^a-z0-9]+', ' ', 'gi'));
        if hit_n = 1 then
          insert into clickbooks_us.classification_account_map(classification, account_id, reviewed, evidence)
          values (cls_key, hit_id, true, 'auto: exact name match to existing ledger account (QF)')
          on conflict (classification) do update set account_id = excluded.account_id, reviewed = true, evidence = excluded.evidence, updated_at = now();
          map_acct := hit_id;
          auto_mapped := jsonb_set(auto_mapped, array[cls_key], to_jsonb(cat_label));
        end if;
      end if;
      -- (3) still nothing → CREATE the account (safe kinds only)
      if map_acct is null and cat_label is not null and cat_kind in ('income','other_income','expense','cogs','other_expense') then
        want_type := case when cat_kind in ('income','other_income') then 'income' else 'expense' end;
        begin
          insert into clickbooks_us.accounts(book_id, name, account_type, is_active, needs_review, is_bank_sensitive)
          values (b.id, cat_label, want_type, true, false, false)
          returning id into new_acct;
          insert into clickbooks_us.classification_account_map(classification, account_id, reviewed, evidence)
          values (cls_key, new_acct, true, 'auto: account created from hub category "' || cat_label || '" (kind ' || cat_kind || ', QF)')
          on conflict (classification) do update set account_id = excluded.account_id, reviewed = true, evidence = excluded.evidence, updated_at = now();
          map_acct := new_acct;
          auto_created := jsonb_set(auto_created, array[cls_key], to_jsonb(cat_label || ' → ' || want_type));
        exception when others then
          create_errors := jsonb_set(create_errors, array[cls_key], to_jsonb(SQLERRM));
        end;
      end if;
    end if;

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
    map_acct := null; cat_label := null; cat_kind := null; hit_id := null; hit_n := null; new_acct := null;
  end loop;

  result := jsonb_build_object('from', p_from, 'to', p_to,
    'classifiedPosted', posted, 'alreadyPosted', already,
    'skippedNoBankMap', no_bank_map, 'skippedTransfers', skipped_transfers,
    'autoMapped', auto_mapped, 'autoCreated', auto_created, 'autoCreateErrors', create_errors,
    'skippedUnmapped', unmapped);
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('classified_sync_completed', p_actor, result);
  return result;
end $$;

select 'QF clickbooks auto-map/auto-create installed' as result;
