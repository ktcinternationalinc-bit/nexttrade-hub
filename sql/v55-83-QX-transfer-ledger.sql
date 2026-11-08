-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-QX — Transfers between our own accounts, posted CORRECTLY in the
-- ClickBooks ledger (Max, Nov 8 11:39: "make sure in accounting it is
-- calculated correctly for accounting and tax purposes... do the proper
-- research").
--
-- Standard treatment (QuickBooks/Quicken practice, IRS): a transfer between
-- two accounts you own is neither income nor a deductible expense — it only
-- moves money between balance-sheet accounts. Fixes two real defects in the
-- previous version of classified_sync_run:
--  1. Transfers were SKIPPED entirely, so the ledger's bank balances never
--     moved (money left Bank A in reality but not in the books). Now each leg
--     posts against 1090 Inter-account transfer clearing (seeded control
--     account): out-leg Dr 1090 / Cr Bank, in-leg Dr Bank / Cr 1090. Paired
--     legs net 1090 to zero; any 1090 balance = money in transit.
--  2. The QF auto-create of a ledger account for a new category omitted the
--     table's required code / normal_side / origin columns, so EVERY create
--     failed into autoCreateErrors. Now it supplies them (code H-<md5>).
-- Same name + signature: the 15-minute job needs no code change.
--
-- REVIEW FIXES (Max, Nov 8 12:00: "look thru the changes we made today and
-- look for any logical gaps"):
--  3. 1090 was seeded needs_review=true, and post_journal refuses ANY line on
--     a needs-review account — the first transfer would have stopped the
--     WHOLE 15-minute ledger run (every posting, not just transfers). 1090 is
--     approved below as the standard transfer clearing account, and the run
--     only uses it when approved (otherwise transfers are counted as skipped).
--  4. Changes made in the hub AFTER an entry reached the ledger never reached
--     the ledger (category changed, transaction matched to an invoice or
--     marked duplicate, payment voided / unmatched, invoice deleted or its
--     total edited). New clickbooks_us.drift_sync_run reverses the stale
--     entry (an audited reversal, never an edit or delete — posted journals
--     stay immutable) and re-posts the corrected one as <id>:r<n>.
--  5. The 15-minute job only looked at the last 24 hours, so anything
--     categorized or matched later than the day after its date never reached
--     the ledger. clickbooks_us_sync_cutoff() lets the job cover the last 31
--     days every tick and the whole period since the opening cutoff daily —
--     never a LOCKED period (a post into a locked date stops the whole run).
--  6. The QF exact-name lookup used min() on an id column — Postgres has no
--     min() for that type, so the FIRST unmapped category raised an error and
--     stopped the whole run (found by running this file on a test database).
--  7. A reviewed row dated inside a locked period stopped the whole run
--     (CB_PERIOD_LOCKED); it is now skipped and counted (skippedLocked).
-- Paste into the Supabase SQL Editor and Run. SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

-- (3) approve the seeded transfer clearing account (asset, debit). Only this
--     exact seeded row; anything else named 1090 is left alone.
update clickbooks_us.accounts set needs_review = false
 where code = '1090' and name = 'Inter-account transfer clearing' and account_type = 'asset'
   and is_active and needs_review
   and book_id = (select id from clickbooks_us.books where code = 'KTC_US');

create or replace function clickbooks_us.classified_sync_run(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text;
  t record; bank_gl uuid; map_acct uuid; n bigint; lines jsonb;
  posted int := 0; already int := 0; no_bank_map int := 0; skipped_transfers int := 0;
  unmapped jsonb := '{}'::jsonb; cls_key text;
  auto_mapped jsonb := '{}'::jsonb; auto_created jsonb := '{}'::jsonb; create_errors jsonb := '{}'::jsonb;
  cat_label text; cat_kind text; want_type text; hit_id uuid; hit_n int; new_acct uuid;
  clearing uuid; posted_transfers int := 0;
  prior_n int; src_id text; skipped_locked int := 0; due uuid;
  result jsonb;
begin
  if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code='KTC_US' for update;
  select * into strict c from clickbooks_us.cutover_control where singleton for update;
  src := b.wave_business_id;
  -- QX: the seeded control account for money moving between OUR OWN accounts
  -- QX review fix: only when APPROVED — a needs-review account would abort the whole run
  select a.id into clearing from clickbooks_us.accounts a where a.book_id = b.id and a.code = '1090' and a.is_active and not a.needs_review;
  if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
  if b.opening_cutoff is null or p_from <= b.opening_cutoff or p_from > p_to or p_to > current_date + 1 or p_to - p_from > 31 then raise exception 'CB_SHADOW_PERIOD'; end if;

  for t in
    select bt.* from public.bank_transactions bt
     where bt.wave_business_id = src
       and bt.pending is false
       and bt.iso_currency = 'USD'
       and bt.review_status in ('reviewed', 'approved') -- RB: approved rows are finished too
       and (bt.classification is not null or bt.third_party_payer is not null) -- RB: money sent to a related company
       and bt.matched_invoice_id is null
       and bt.linked_id is null
       and not clickbooks_us.has_piecewise(bt.id) -- RB: split / partly-placed rows are booked whole by deposit_sync_run, never twice
       and coalesce(bt.posted_date, bt.date) between p_from and p_to
     order by coalesce(bt.posted_date, bt.date), bt.id
  loop
    -- once per transaction while LIVE: an entry the drift check reversed
    -- (hub changed after posting) no longer counts — the corrected entry posts
    -- as <txn id>:r<n>, keeping post_journal's source identity unique.
    if exists(select 1 from clickbooks_us.journals j
               where j.book_id = b.id and j.source_kind = 'bank_transaction'
                 and (j.source_id = t.id::text or j.source_id like t.id::text || ':r%')
                 and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = j.id)) then
      already := already + 1; continue;
    end if;
    -- a closed (locked) period is never posted into — skip, never abort the run
    if b.locked_through is not null and coalesce(t.posted_date, t.date) <= b.locked_through then
      skipped_locked := skipped_locked + 1; continue;
    end if;
    select count(*) into prior_n from clickbooks_us.journals j
     where j.book_id = b.id and j.source_kind = 'bank_transaction'
       and (j.source_id = t.id::text or j.source_id like t.id::text || ':r%');
    src_id := case when prior_n = 0 then t.id::text else t.id::text || ':r' || prior_n::text end;
    cls_key := trim(t.classification); bank_gl := null; map_acct := null;
    if cls_key is null or cls_key = '' then cls_key := 'advance to ' || coalesce(t.third_party_payer, '?'); end if; -- RB
    -- (1) QX — a transfer between our own accounts is NEVER income or expense,
    --     but the BANK balances must still move. Each leg posts against 1090
    --     Inter-account transfer clearing:
    --       out-leg: Dr 1090 / Cr Bank A      in-leg: Dr Bank B / Cr 1090
    --     When both legs are posted 1090 nets to zero; a non-zero 1090 is
    --     money in transit (other leg unpaired or its account not in the hub)
    --     — a reconciliation item, never P&L.
    if cls_key = 'transfer' or t.transfer_group_id is not null then
      select m.account_id into bank_gl
        from clickbooks_us.bank_ledger_map m
        join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = m.book_id
       where m.book_id = b.id and m.provider_account_id = t.account_id and m.reviewed
         and a.is_active and not a.needs_review and a.is_bank_sensitive;
      if clearing is null or bank_gl is null then skipped_transfers := skipped_transfers + 1; continue; end if;
      n := clickbooks_us.money_cents(t.amount_abs::text);
      if t.direction = 'out' then
        lines := jsonb_build_array(
          jsonb_build_object('account_id', clearing, 'debit_cents', n::text, 'credit_cents', '0'),
          jsonb_build_object('account_id', bank_gl,  'debit_cents', '0',     'credit_cents', n::text));
      elsif t.direction = 'in' then
        lines := jsonb_build_array(
          jsonb_build_object('account_id', bank_gl,  'debit_cents', n::text, 'credit_cents', '0'),
          jsonb_build_object('account_id', clearing, 'debit_cents', '0',     'credit_cents', n::text));
      else
        continue;
      end if;
      perform clickbooks_us.post_journal(b.id, coalesce(t.posted_date, t.date),
        'Transfer between own accounts ' || t.id::text || coalesce(' (group ' || t.transfer_group_id::text || ')', ''),
        'bank_transaction', src_id, lines, p_actor);
      posted_transfers := posted_transfers + 1;
      continue;
    end if;
    -- RB: money sent to a RELATED company (NextTrade Industries) is an advance
    -- (an asset: Due from), not an expense, until its costs are linked.
    due := clickbooks_us.affiliate_due_account(b.id, t.third_party_payer);
    map_acct := due;
    if due is null then
    select m.account_id into map_acct
      from clickbooks_us.classification_account_map m
      join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = b.id
     where m.classification = cls_key and m.reviewed
       and a.is_active and not a.needs_review and not a.is_bank_sensitive;
    end if;

    if map_acct is null then
      -- hub category drives the automation
      select ec.label, coalesce(ec.kind, 'expense') into cat_label, cat_kind
        from public.expense_categories ec where ec.key = cls_key;
      -- (2) EXACT normalized-name match, single hit only
      if cat_label is not null then
        select count(*), (array_agg(a.id order by a.id::text))[1] into hit_n, hit_id
          from clickbooks_us.accounts a
         where a.book_id = b.id and a.is_active and not a.is_bank_sensitive and not a.needs_review -- RB: a needs-review match would abort the run at posting
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
          insert into clickbooks_us.accounts(book_id, code, name, account_type, normal_side, is_active, needs_review, is_bank_sensitive, origin)
          values (b.id, 'H-' || md5(cls_key), cat_label, want_type, case when want_type = 'expense' then 'debit' else 'credit' end, true, false, false, 'manual')
          on conflict (book_id, code) do update set is_active = true
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
      'bank_transaction', src_id, lines, p_actor);
    posted := posted + 1;
    map_acct := null; cat_label := null; cat_kind := null; hit_id := null; hit_n := null; new_acct := null;
  end loop;

  result := jsonb_build_object('from', p_from, 'to', p_to,
    'classifiedPosted', posted, 'alreadyPosted', already,
    'skippedNoBankMap', no_bank_map, 'postedTransfers', posted_transfers, 'skippedTransfers', skipped_transfers,
    'skippedLocked', skipped_locked,
    'autoMapped', auto_mapped, 'autoCreated', auto_created, 'autoCreateErrors', create_errors,
    'skippedUnmapped', unmapped);
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('classified_sync_completed', p_actor, result);
  return result;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- (4) DRIFT CHECK — keeps the ledger consistent with the hub AFTER posting.
-- Posted journals are immutable: a stale entry is REVERSED (an audited
-- reversal dated on the original date) and the corrected entry is posted
-- under <id>:r<n>. A change touching a LOCKED (closed) period is never
-- applied automatically — it is counted in lockedPeriodChanges for the
-- accountant (a closed month is not silently re-opened).
--   • bank-transaction entries (classified, transfers, rule path):
--       transaction gone / marked duplicate / now matched to an invoice →
--       reverse (the payment entry carries a matched deposit);
--       REVIEWED row whose category, transfer status or amount no longer
--       produces the same lines → reverse (classified_sync_run re-posts);
--       category removed → reverse. Unreviewed rows wait for review.
--   • invoice-payment entries: payment gone / voided / amount changed →
--       reverse; a payment that is live again (re-match revives it) is
--       re-posted with the engine's own checks.
--   • invoice entries: invoice deleted / not active / not approved / total
--       changed → reverse; a live approved invoice whose only entries were
--       reversed is re-posted with the engine's own integrity checks.
-- One bad entry never stops the run: per-entry errors are collected.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function clickbooks_us.drift_sync_run(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text;
  j record; t record; pp record; x record; bank record;
  clearing uuid; bank_gl uuid; exp_acct uuid; ar uuid; income uuid;
  n bigint; lines jsonb; want jsonb; have jsonb; rdate date; why text; prior_n int; base_id text;
  rev_bank int := 0; rev_pay int := 0; rev_inv int := 0; repost_pay int := 0; repost_inv int := 0;
  skipped int := 0; errors jsonb := '[]'::jsonb; result jsonb;
  locked_changed int := 0; locked_list jsonb := '[]'::jsonb;
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code='KTC_US' for update;
  select * into strict c from clickbooks_us.cutover_control where singleton for update;
  src := b.wave_business_id;
  if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
  select a.id into clearing from clickbooks_us.accounts a where a.book_id = b.id and a.code = '1090' and a.is_active and not a.needs_review;
  select a.id into ar from clickbooks_us.accounts a where a.book_id = b.id and a.code = '1100';
  select d.invoice_income_account_id into income from clickbooks_us.posting_defaults d
    join clickbooks_us.accounts a on a.id = d.invoice_income_account_id and a.book_id = d.book_id
   where d.book_id = b.id and d.reviewed and a.is_active and not a.needs_review and a.account_type = 'income';

  -- (A) bank-transaction entries
  for j in
    select jj.* from clickbooks_us.journals jj
     where jj.book_id = b.id and jj.status = 'posted' and jj.source_kind = 'bank_transaction'
       and jj.source_id !~ ':d[0-9]+$' -- RB: deposit-path entries are checked by deposit_sync_run
       and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)
     order by jj.entry_date, jj.id
  loop
    why := null; bank_gl := null; exp_acct := null; want := null; have := null;
    base_id := split_part(j.source_id, ':', 1);
    if base_id !~ uuid_re then continue; end if;
    select bt.* into t from public.bank_transactions bt where bt.id = base_id::uuid;
    if not found then
      why := 'bank transaction no longer in the hub';
    elsif t.review_status = 'duplicate' then
      why := 'marked as a duplicate copy';
    elsif t.matched_invoice_id is not null or t.linked_id is not null then
      why := 'now matched to an invoice (the payment entry carries it)';
    elsif t.pending is true then
      continue;
    elsif clickbooks_us.has_piecewise(t.id) then
      why := 'now split or partly placed (the deposit path books it whole)';
    elsif t.review_status in ('reviewed', 'approved') and (t.classification is not null or t.transfer_group_id is not null
          or clickbooks_us.affiliate_due_account(b.id, t.third_party_payer) is not null) then
      select m.account_id into bank_gl
        from clickbooks_us.bank_ledger_map m
        join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = m.book_id
       where m.book_id = b.id and m.provider_account_id = t.account_id and m.reviewed
         and a.is_active and not a.needs_review and a.is_bank_sensitive;
      if bank_gl is null then continue; end if;
      if trim(coalesce(t.classification, '')) = 'transfer' or t.transfer_group_id is not null then
        exp_acct := clearing;
      elsif clickbooks_us.affiliate_due_account(b.id, t.third_party_payer) is not null then
        exp_acct := clickbooks_us.affiliate_due_account(b.id, t.third_party_payer);
      else
        select m.account_id into exp_acct
          from clickbooks_us.classification_account_map m
          join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = b.id
         where m.classification = trim(t.classification) and m.reviewed
           and a.is_active and not a.needs_review and not a.is_bank_sensitive;
      end if;
      if exp_acct is null then
        -- no ledger account for the CURRENT category yet: reverse only when the
        -- category really changed (the next classified run maps or creates it)
        if j.description not like '%(' || trim(coalesce(t.classification, '')) || ')' then
          why := 'category changed after posting (new category gets its ledger account on the next run)';
        end if;
      else
        n := clickbooks_us.money_cents(t.amount_abs::text);
        if t.direction = 'out' then
          want := jsonb_build_array(jsonb_build_array(bank_gl::text, 0, n), jsonb_build_array(exp_acct::text, n, 0));
        elsif t.direction = 'in' then
          want := jsonb_build_array(jsonb_build_array(bank_gl::text, n, 0), jsonb_build_array(exp_acct::text, 0, n));
        end if;
        if want is not null then
          select jsonb_agg(v order by v->>0, (v->>1)::bigint, (v->>2)::bigint) into want from jsonb_array_elements(want) v;
          select jsonb_agg(jsonb_build_array(l.account_id::text, l.debit_cents, l.credit_cents)
                           order by l.account_id::text, l.debit_cents, l.credit_cents) into have
            from clickbooks_us.journal_lines l where l.journal_id = j.id;
          if have is distinct from want then why := 'category, transfer status or amount changed after posting'; end if;
        end if;
      end if;
    elsif t.classification is null and t.transfer_group_id is null and j.description not like 'Rule-classified%' then
      why := 'category removed after posting';
    else
      continue; -- unreviewed with a category: the bridge waits for review
    end if;
    if why is not null and b.locked_through is not null and j.entry_date <= b.locked_through then
      locked_changed := locked_changed + 1;
      if jsonb_array_length(locked_list) < 50 then
        locked_list := locked_list || jsonb_build_array(jsonb_build_object('journal', j.id, 'date', j.entry_date, 'source', j.source_kind || ' ' || base_id, 'why', why));
      end if;
      why := null;
    end if;
    if why is not null then
      rdate := j.entry_date;
      begin
        perform clickbooks_us.reverse_journal(j.id, rdate, left('Hub changed: ' || why || ' (bank transaction ' || base_id || ')', 1800), p_actor);
        rev_bank := rev_bank + 1;
      exception when others then
        errors := errors || jsonb_build_array(jsonb_build_object('journal', j.id, 'kind', 'bank_transaction', 'error', SQLERRM));
      end;
    end if;
  end loop;

  -- (B) invoice-payment entries
  for j in
    select jj.* from clickbooks_us.journals jj
     where jj.book_id = b.id and jj.status = 'posted' and jj.source_kind = 'accounting_invoice_payment'
       and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)
     order by jj.entry_date, jj.id
  loop
    why := null;
    base_id := split_part(j.source_id, ':', 1);
    if base_id !~ uuid_re then continue; end if;
    select p2.* into pp from public.accounting_invoice_payments p2 where p2.id = base_id::uuid;
    if not found then
      why := 'payment no longer in the hub (invoice deleted)';
    elsif pp.voided is true then
      why := 'payment voided (unmatched, or its invoice was deleted)';
    elsif exists(select 1 from public.bank_transactions bx where bx.id = pp.bank_transaction_id)
      and (select coalesce(sum(p4.amount), 0) from public.accounting_invoice_payments p4 where p4.bank_transaction_id = pp.bank_transaction_id and p4.voided is not true)
          is distinct from (select bx.amount_abs from public.bank_transactions bx where bx.id = pp.bank_transaction_id) then
      why := 'deposit is no longer fully covered by invoice payments (the deposit path books it whole)';
    else
      select coalesce(sum(l.credit_cents), 0) into n from clickbooks_us.journal_lines l where l.journal_id = j.id and l.account_id = ar;
      if n <> clickbooks_us.money_cents(pp.amount::text) then why := 'payment amount changed'; end if;
    end if;
    if why is not null and b.locked_through is not null and j.entry_date <= b.locked_through then
      locked_changed := locked_changed + 1;
      if jsonb_array_length(locked_list) < 50 then
        locked_list := locked_list || jsonb_build_array(jsonb_build_object('journal', j.id, 'date', j.entry_date, 'source', j.source_kind || ' ' || base_id, 'why', why));
      end if;
      why := null;
    end if;
    if why is not null then
      rdate := j.entry_date;
      begin
        perform clickbooks_us.reverse_journal(j.id, rdate, left('Hub changed: ' || why || ' (payment ' || base_id || ')', 1800), p_actor);
        rev_pay := rev_pay + 1;
      exception when others then
        errors := errors || jsonb_build_array(jsonb_build_object('journal', j.id, 'kind', 'payment', 'error', SQLERRM));
      end;
    end if;
  end loop;

  -- (C) invoice entries
  for j in
    select jj.* from clickbooks_us.journals jj
     where jj.book_id = b.id and jj.status = 'posted' and jj.source_kind = 'accounting_invoice'
       and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)
     order by jj.entry_date, jj.id
  loop
    why := null;
    base_id := split_part(j.source_id, ':', 1);
    if base_id !~ uuid_re then continue; end if;
    select xi.* into x from public.accounting_invoices xi where xi.id = base_id::uuid;
    if not found then
      why := 'invoice deleted';
    elsif x.record_status is distinct from 'active' or x.approval_status is distinct from 'approved' then
      why := 'invoice voided or no longer approved';
    else
      select coalesce(sum(l.debit_cents), 0) into n from clickbooks_us.journal_lines l where l.journal_id = j.id and l.account_id = ar;
      if n <> clickbooks_us.money_cents(coalesce(x.total_amount, 0)::text) then why := 'invoice total changed'; end if;
    end if;
    if why is not null and b.locked_through is not null and j.entry_date <= b.locked_through then
      locked_changed := locked_changed + 1;
      if jsonb_array_length(locked_list) < 50 then
        locked_list := locked_list || jsonb_build_array(jsonb_build_object('journal', j.id, 'date', j.entry_date, 'source', j.source_kind || ' ' || base_id, 'why', why));
      end if;
      why := null;
    end if;
    if why is not null then
      rdate := j.entry_date;
      begin
        perform clickbooks_us.reverse_journal(j.id, rdate, left('Hub changed: ' || why || ' (invoice ' || base_id || ')', 1800), p_actor);
        rev_inv := rev_inv + 1;
      exception when others then
        errors := errors || jsonb_build_array(jsonb_build_object('journal', j.id, 'kind', 'invoice', 'error', SQLERRM));
      end;
    end if;
  end loop;

  -- (D) re-post invoices whose only entries were reversed (edited total, re-approved)
  if ar is not null and income is not null then
    for x in
      select xi.* from public.accounting_invoices xi
       where xi.wave_business_id = src and xi.currency = 'USD' and xi.record_status = 'active' and xi.approval_status = 'approved'
         and xi.invoice_date > b.opening_cutoff
         and exists(select 1 from clickbooks_us.journals j2 where j2.book_id = b.id and j2.source_kind = 'accounting_invoice'
                      and (j2.source_id = xi.id::text or j2.source_id like xi.id::text || ':r%'))
         and not exists(select 1 from clickbooks_us.journals j2 where j2.book_id = b.id and j2.source_kind = 'accounting_invoice'
                      and (j2.source_id = xi.id::text or j2.source_id like xi.id::text || ':r%')
                      and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = j2.id))
       order by xi.invoice_date, xi.id
    loop
      -- the engine's own integrity rules
      if not exists(select 1 from public.accounting_invoice_items li where li.invoice_id = x.id)
         or coalesce(x.total_amount, 0) <= 0 or coalesce(x.amount_paid, 0) < 0 or coalesce(x.amount_paid, 0) > coalesce(x.total_amount, 0)
         or coalesce(x.total_amount, 0) <> (select coalesce(sum(li.line_total), 0) from public.accounting_invoice_items li where li.invoice_id = x.id)
         or coalesce(x.amount_paid, 0) <> (select coalesce(sum(p3.amount), 0) from public.accounting_invoice_payments p3 where p3.accounting_invoice_id = x.id and p3.wave_business_id = src and p3.voided is not true)
         or (b.locked_through is not null and x.invoice_date <= b.locked_through)
      then skipped := skipped + 1; continue; end if;
      select count(*) into prior_n from clickbooks_us.journals j2 where j2.book_id = b.id and j2.source_kind = 'accounting_invoice'
        and (j2.source_id = x.id::text or j2.source_id like x.id::text || ':r%');
      n := clickbooks_us.money_cents(x.total_amount::text);
      lines := jsonb_build_array(
        jsonb_build_object('account_id', ar,     'debit_cents', n::text, 'credit_cents', '0'),
        jsonb_build_object('account_id', income, 'debit_cents', '0',     'credit_cents', n::text));
      begin
        perform clickbooks_us.post_journal(b.id, x.invoice_date, 'Invoice ' || coalesce(x.invoice_number, x.id::text) || ' (re-posted after hub change)',
          'accounting_invoice', x.id::text || ':r' || prior_n::text, lines, p_actor);
        repost_inv := repost_inv + 1;
      exception when others then
        errors := errors || jsonb_build_array(jsonb_build_object('invoice', x.id, 'kind', 'invoice_repost', 'error', SQLERRM));
      end;
    end loop;
  end if;

  -- (E) re-post payments that are live again (re-match revived a voided row)
  if ar is not null then
    for pp in
      select p2.* from public.accounting_invoice_payments p2
        join public.accounting_invoices ii on ii.id = p2.accounting_invoice_id and ii.wave_business_id = src and ii.currency = 'USD'
       where p2.wave_business_id = src and p2.voided is not true and p2.payment_date > b.opening_cutoff
         and exists(select 1 from clickbooks_us.journals j2 where j2.book_id = b.id and j2.source_kind = 'accounting_invoice_payment'
                      and (j2.source_id = p2.id::text or j2.source_id like p2.id::text || ':r%'))
         and not exists(select 1 from clickbooks_us.journals j2 where j2.book_id = b.id and j2.source_kind = 'accounting_invoice_payment'
                      and (j2.source_id = p2.id::text or j2.source_id like p2.id::text || ':r%')
                      and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = j2.id))
       order by p2.payment_date, p2.id
    loop
      -- the engine's own payment discipline (opening-balance receivables stay engine-only)
      if not exists(select 1 from clickbooks_us.journals j2 where j2.book_id = b.id and j2.source_kind = 'accounting_invoice'
                      and (j2.source_id = pp.accounting_invoice_id::text or j2.source_id like pp.accounting_invoice_id::text || ':r%')
                      and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = j2.id))
         or (b.locked_through is not null and pp.payment_date <= b.locked_through)
      then skipped := skipped + 1; continue; end if;
      select bt.* into bank from public.bank_transactions bt
       where bt.id = pp.bank_transaction_id and bt.wave_business_id = src and bt.pending is false and bt.iso_currency = 'USD' and bt.direction = 'in';
      if not found then skipped := skipped + 1; continue; end if;
      if (select coalesce(sum(p3.amount), 0) from public.accounting_invoice_payments p3 where p3.bank_transaction_id = bank.id and p3.wave_business_id = src and p3.voided is not true) is distinct from bank.amount_abs then
        skipped := skipped + 1; continue;
      end if;
      bank_gl := null;
      select m.account_id into bank_gl
        from clickbooks_us.bank_ledger_map m
        join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = m.book_id
       where m.book_id = b.id and m.provider_account_id = bank.account_id and m.reviewed
         and a.is_active and not a.needs_review and a.is_bank_sensitive;
      if bank_gl is null then skipped := skipped + 1; continue; end if;
      select count(*) into prior_n from clickbooks_us.journals j2 where j2.book_id = b.id and j2.source_kind = 'accounting_invoice_payment'
        and (j2.source_id = pp.id::text or j2.source_id like pp.id::text || ':r%');
      n := clickbooks_us.money_cents(pp.amount::text);
      lines := jsonb_build_array(
        jsonb_build_object('account_id', bank_gl, 'debit_cents', n::text, 'credit_cents', '0'),
        jsonb_build_object('account_id', ar,      'debit_cents', '0',     'credit_cents', n::text));
      begin
        perform clickbooks_us.post_journal(b.id, pp.payment_date, 'Invoice payment ' || pp.id::text || ' (re-posted after hub change)',
          'accounting_invoice_payment', pp.id::text || ':r' || prior_n::text, lines, p_actor);
        repost_pay := repost_pay + 1;
      exception when others then
        errors := errors || jsonb_build_array(jsonb_build_object('payment', pp.id, 'kind', 'payment_repost', 'error', SQLERRM));
      end;
    end loop;
  end if;

  result := jsonb_build_object('reversedBank', rev_bank, 'reversedPayments', rev_pay, 'reversedInvoices', rev_inv,
    'repostedInvoices', repost_inv, 'repostedPayments', repost_pay, 'skippedForReview', skipped,
    'lockedPeriodChanges', locked_changed, 'lockedPeriodList', locked_list, 'errors', errors);
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('drift_sync_completed', p_actor, result);
  return result;
end $$;

create or replace function public.clickbooks_us_drift_sync_job(p_actor uuid) returns jsonb
language sql security definer set search_path='' as $$ select clickbooks_us.drift_sync_run(p_actor) $$;
revoke all on function public.clickbooks_us_drift_sync_job(uuid) from public, anon, authenticated;
grant execute on function public.clickbooks_us_drift_sync_job(uuid) to service_role;

-- (5) the last date the job must NOT post into — the opening cutoff, or the
--     locked-through date when later — so the 15-minute job can cover the
--     last 31 days each tick and the whole open period once a day (read-only).
create or replace function public.clickbooks_us_sync_cutoff() returns date
language sql stable security definer set search_path='' as $$
  select greatest(opening_cutoff, coalesce(locked_through, opening_cutoff)) from clickbooks_us.books where code = 'KTC_US' $$;
revoke all on function public.clickbooks_us_sync_cutoff() from public, anon, authenticated;
grant execute on function public.clickbooks_us_sync_cutoff() to service_role;

select 'QX transfers-to-clearing + fixed auto-create + drift check + 31-day window installed' as result
union all
select '1090 transfer clearing approved: ' || case when exists(select 1 from clickbooks_us.accounts a join clickbooks_us.books bk on bk.id = a.book_id
  where bk.code = 'KTC_US' and a.code = '1090' and a.is_active and not a.needs_review) then '✅ yes' else '❌ NO — transfers will be skipped' end;
