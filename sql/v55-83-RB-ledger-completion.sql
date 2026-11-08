-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RB — ClickBooks ledger: the open items of the Nov 8 gap review
-- (Max, Nov 8 12:23: "complete all of the gap review items not yet completed").
--
--  1. SPLIT / PARTLY-PLACED money never reached the ledger (the engine books a
--     deposit only when invoice payments cover it exactly). deposit_sync_run
--     now books such a transaction WHOLE, once: invoice payments → receivable,
--     parked remainder / customer credit → 2400 Unapplied customer receipts,
--     split lines → their category accounts. Re-checked every run; a change
--     reverses it (audited) and books the corrected version.
--  2. BANK ACCOUNTS WITHOUT A LEDGER ACCOUNT (M&T, PNC, any CSV-only account,
--     a Plaid reconnect) never posted. bank_map_sync_run gives each one its
--     ledger bank account automatically; the Plaid twin of an account
--     (same bank + last 4) reuses the SAME ledger account. Opening balances:
--     public.clickbooks_us_bank_opening_balance('PNC', '1234', 15230.55).
--  3. NEXTTRADE INDUSTRIES (related company): money sent to it is an ADVANCE
--     (asset "Due from NextTrade Industries"), never an expense by itself;
--     each bill it pays for us books the real cost in the bill's category
--     against that advance (affiliate_bill_sync_run). RTM Capital (service
--     provider) is unchanged: one professional-fee line, as decided.
--  4. ENGINE HAZARD: a rule proposal approved for a transaction that had an
--     earlier (reversed) entry would stop the whole engine run
--     (CB_IDEMPOTENCY_CONFLICT). The rule path now skips it.
-- Paste into the Supabase SQL Editor AFTER the QX part and Run. SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── helpers ────────────────────────────────────────────────────────────────
-- A transaction placed PIECEWISE (invoice payments, parked money, split lines)
-- is booked by the deposit path, never by the whole-category path.
create or replace function clickbooks_us.has_piecewise(p_txn uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.accounting_invoice_payments p where p.bank_transaction_id = p_txn and p.voided is not true)
      or exists(select 1 from public.unapplied_deposits u where u.bank_transaction_id = p_txn and (u.status is null or u.status = 'open'))
      or exists(select 1 from public.customer_credits c where c.source_transaction_id = p_txn and (c.status is null or c.status = 'open'))
      or exists(select 1 from public.bank_transaction_splits s where s.bank_transaction_id = p_txn and coalesce(s.linked_type, '') <> 'invoice')
$$;

-- "Due from <related company>" — only for parties registered as affiliate.
create or replace function clickbooks_us.affiliate_due_account(p_book uuid, p_payer text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare k text; nm text; kd text; acct uuid; cd text;
begin
  if p_payer is null or trim(p_payer) = '' or to_regclass('public.paid_through_parties') is null then return null; end if;
  k := trim(regexp_replace(lower(p_payer), '[^a-z0-9]+', ' ', 'g'));
  select p.name, p.kind into nm, kd from public.paid_through_parties p
   where trim(regexp_replace(lower(p.name), '[^a-z0-9]+', ' ', 'g')) = k and p.active
   order by p.sort limit 1;
  if nm is null or kd is distinct from 'affiliate' then return null; end if;
  cd := 'D-' || md5(lower(nm));
  insert into clickbooks_us.accounts(book_id, code, name, account_type, normal_side, is_bank_sensitive, is_active, needs_review, origin)
  values (p_book, cd, left('Due from ' || nm || ' (advances — not an expense)', 200), 'asset', 'debit', false, true, false, 'manual')
  on conflict (book_id, code) do nothing;
  select a.id into acct from clickbooks_us.accounts a where a.book_id = p_book and a.code = cd and a.is_active and not a.needs_review;
  return acct;
end $$;

-- Ledger account for a hub category: reviewed mapping; else one APPROVED
-- account with exactly the same name; else create it (safe kinds only).
create or replace function clickbooks_us.category_account(p_book uuid, p_key text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare k text := trim(coalesce(p_key, '')); acct uuid; lbl text; knd text; hit_n int; hit_id uuid; typ text; cd text;
begin
  if k = '' then return null; end if;
  select m.account_id into acct from clickbooks_us.classification_account_map m
    join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = p_book
   where m.classification = k and m.reviewed and a.is_active and not a.needs_review and not a.is_bank_sensitive;
  if acct is not null then return acct; end if;
  select ec.label, coalesce(ec.kind, 'expense') into lbl, knd from public.expense_categories ec where ec.key = k;
  if lbl is null then return null; end if;
  select count(*), (array_agg(a.id order by a.id::text))[1] into hit_n, hit_id from clickbooks_us.accounts a
   where a.book_id = p_book and a.is_active and not a.needs_review and not a.is_bank_sensitive
     and lower(regexp_replace(a.name, '[^a-z0-9]+', ' ', 'gi')) = lower(regexp_replace(lbl, '[^a-z0-9]+', ' ', 'gi'));
  if hit_n = 1 then
    acct := hit_id;
  elsif knd in ('income', 'other_income', 'expense', 'cogs', 'other_expense') then
    typ := case when knd in ('income', 'other_income') then 'income' else 'expense' end;
    cd := 'H-' || md5(k);
    insert into clickbooks_us.accounts(book_id, code, name, account_type, normal_side, is_active, needs_review, is_bank_sensitive, origin)
    values (p_book, cd, lbl, typ, case when typ = 'expense' then 'debit' else 'credit' end, true, false, false, 'manual')
    on conflict (book_id, code) do nothing;
    select a.id into acct from clickbooks_us.accounts a where a.book_id = p_book and a.code = cd and a.is_active and not a.needs_review;
  end if;
  if acct is not null then
    insert into clickbooks_us.classification_account_map(classification, account_id, reviewed, evidence)
    values (k, acct, true, 'auto (RB): category "' || lbl || '"')
    on conflict (classification) do update set account_id = excluded.account_id, reviewed = true, evidence = excluded.evidence, updated_at = now();
  end if;
  return acct;
end $$;

-- ── (1) split / partly-placed transactions ─────────────────────────────────
-- What the ledger must hold for one piecewise transaction:
--   {"ok":true,"lines":[[account,debit,credit],...]}  or  {"ok":false,"why":...}
create or replace function clickbooks_us.deposit_lines(p_book uuid, p_txn uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; t record; bank_gl uuid; ar uuid; unap uuid; amt bigint;
  bad int; tot bigint; only_ar boolean; lines jsonb; inv_missing int;
begin
  select * into b from clickbooks_us.books where id = p_book;
  select bt.* into t from public.bank_transactions bt where bt.id = p_txn;
  if not found then return jsonb_build_object('ok', false, 'why', 'transaction no longer in the hub'); end if;
  if t.wave_business_id is distinct from b.wave_business_id or t.iso_currency is distinct from 'USD' then return jsonb_build_object('ok', false, 'why', 'other books or currency'); end if;
  if t.pending is true then return jsonb_build_object('ok', false, 'why', 'still pending'); end if;
  if t.review_status = 'duplicate' then return jsonb_build_object('ok', false, 'why', 'marked as a duplicate copy'); end if;
  if t.review_status is distinct from 'reviewed' and t.review_status is distinct from 'approved' then return jsonb_build_object('ok', false, 'why', 'not finished (reviewed) yet'); end if;
  if t.transfer_group_id is not null then return jsonb_build_object('ok', false, 'why', 'paired transfer'); end if;
  if t.direction is distinct from 'in' and t.direction is distinct from 'out' then return jsonb_build_object('ok', false, 'why', 'no direction'); end if;
  if not clickbooks_us.has_piecewise(t.id) then return jsonb_build_object('ok', false, 'why', 'whole-category row (classified path)'); end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m
    join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = m.book_id
   where m.book_id = p_book and m.provider_account_id = t.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive;
  if bank_gl is null then return jsonb_build_object('ok', false, 'why', 'bank account has no ledger account yet'); end if;
  select a.id into ar from clickbooks_us.accounts a where a.book_id = p_book and a.code = '1100' and a.is_active and not a.needs_review;
  select a.id into unap from clickbooks_us.accounts a where a.book_id = p_book and a.code = '2400' and a.is_active and not a.needs_review;
  if ar is null or unap is null then return jsonb_build_object('ok', false, 'why', 'receivable (1100) or unapplied receipts (2400) not approved'); end if;
  amt := round(t.amount_abs * 100)::bigint;
  if t.direction = 'in' then
    select count(*) into inv_missing from public.accounting_invoice_payments p
     where p.bank_transaction_id = t.id and p.voided is not true
       and not exists(select 1 from clickbooks_us.journals j where j.book_id = p_book and j.source_kind = 'accounting_invoice'
                        and (j.source_id = p.accounting_invoice_id::text or j.source_id like p.accounting_invoice_id::text || ':r%')
                        and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = j.id))
       and not exists(select 1 from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id = o.run_id and mr.state = 'committed'
                       where o.book_id = p_book and o.kind = 'receivable' and o.source_ref = p.accounting_invoice_id::text);
    if inv_missing > 0 then return jsonb_build_object('ok', false, 'why', 'an invoice it pays is not in the ledger yet'); end if;
  elsif exists(select 1 from public.accounting_invoice_payments p where p.bank_transaction_id = t.id and p.voided is not true)
     or exists(select 1 from public.unapplied_deposits u where u.bank_transaction_id = t.id and (u.status is null or u.status = 'open'))
     or exists(select 1 from public.customer_credits c where c.source_transaction_id = t.id and (c.status is null or c.status = 'open')) then
    return jsonb_build_object('ok', false, 'why', 'money out cannot carry invoice payments or parked receipts');
  end if;
  with parts as (
    select ar as acct, round(p.amount * 100)::bigint as cents from public.accounting_invoice_payments p where p.bank_transaction_id = p_txn and p.voided is not true
    union all
    select unap, round(u.amount * 100)::bigint from public.unapplied_deposits u where u.bank_transaction_id = p_txn and (u.status is null or u.status = 'open')
    union all
    select unap, round(c.amount * 100)::bigint from public.customer_credits c where c.source_transaction_id = p_txn and (c.status is null or c.status = 'open')
    union all
    select coalesce(
             (select cm.account_id from clickbooks_us.classification_account_map cm
                join clickbooks_us.accounts a on a.id = cm.account_id and a.book_id = p_book
               where cm.classification = trim(s.category) and cm.reviewed and a.is_active and not a.needs_review and not a.is_bank_sensitive),
             (select (array_agg(a2.id order by a2.id::text))[1] from clickbooks_us.accounts a2
               where a2.book_id = p_book and a2.is_active and not a2.needs_review and not a2.is_bank_sensitive
                 and lower(trim(a2.name)) = lower(trim(s.category)) having count(*) = 1),
             case when t.direction = 'in' then unap end),
           round(s.split_amount * 100)::bigint
      from public.bank_transaction_splits s where s.bank_transaction_id = p_txn and coalesce(s.linked_type, '') <> 'invoice'
  ), g as (select acct, sum(cents)::bigint as tot_c from parts group by acct)
  select (select count(*) from parts where acct is null),
         (select coalesce(sum(cents), 0)::bigint from parts),
         (select bool_and(acct = ar) from parts),
         (select jsonb_agg(x order by x->>0, (x->>1)::bigint, (x->>2)::bigint) from (
            select jsonb_build_array(bank_gl::text, case when t.direction = 'in' then amt else 0 end, case when t.direction = 'in' then 0 else amt end) as x
            union all
            select jsonb_build_array(g.acct::text, case when t.direction = 'in' then 0 else g.tot_c end, case when t.direction = 'in' then g.tot_c else 0 end)
              from g where g.acct is not null and g.tot_c <> 0) q)
    into bad, tot, only_ar, lines;
  if bad > 0 then return jsonb_build_object('ok', false, 'why', 'a split line''s category has no ledger account'); end if;
  if tot <> amt then return jsonb_build_object('ok', false, 'why', 'not every dollar is placed yet'); end if;
  if t.direction = 'in' and only_ar then return jsonb_build_object('ok', false, 'why', 'paid in full by invoice payments (the payment entries book it)'); end if;
  return jsonb_build_object('ok', true, 'lines', lines);
end $$;

create or replace function clickbooks_us.deposit_sync_run(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text;
  j record; t record; res jsonb; have jsonb; why text; base_id text; prior_n int; lines jsonb;
  posted int := 0; reversed int := 0; already int := 0; locked_n int := 0;
  waiting jsonb := '{}'::jsonb; errors jsonb := '[]'::jsonb; result jsonb;
begin
  if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US' for update;
  select * into strict c from clickbooks_us.cutover_control where singleton for update;
  src := b.wave_business_id;
  if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
  if b.opening_cutoff is null or p_from <= b.opening_cutoff or p_from > p_to or p_to > current_date + 1 or p_to - p_from > 31 then raise exception 'CB_SHADOW_PERIOD'; end if;

  -- (a) every live deposit-path entry must still say what the hub says
  for j in
    select jj.* from clickbooks_us.journals jj
     where jj.book_id = b.id and jj.status = 'posted' and jj.source_kind = 'bank_transaction' and jj.source_id ~ ':d[0-9]+$'
       and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)
     order by jj.entry_date, jj.id
  loop
    base_id := split_part(j.source_id, ':', 1);
    res := clickbooks_us.deposit_lines(b.id, base_id::uuid);
    select jsonb_agg(jsonb_build_array(l.account_id::text, l.debit_cents, l.credit_cents) order by l.account_id::text, l.debit_cents, l.credit_cents)
      into have from clickbooks_us.journal_lines l where l.journal_id = j.id;
    if coalesce((res->>'ok')::boolean, false) and res->'lines' = have then continue; end if;
    why := coalesce(res->>'why', 'split, parked amount or invoice payments changed');
    if b.locked_through is not null and j.entry_date <= b.locked_through then locked_n := locked_n + 1; continue; end if;
    begin
      perform clickbooks_us.reverse_journal(j.id, j.entry_date, left('Hub changed: ' || why || ' (bank transaction ' || base_id || ')', 1800), p_actor);
      reversed := reversed + 1;
    exception when others then
      errors := errors || jsonb_build_array(jsonb_build_object('journal', j.id, 'error', SQLERRM));
    end;
  end loop;

  -- (b) book every finished piecewise transaction in the window, once
  for t in
    select bt.id, coalesce(bt.posted_date, bt.date) as d from public.bank_transactions bt
     where bt.wave_business_id = src and bt.pending is false and bt.iso_currency = 'USD'
       and bt.review_status in ('reviewed', 'approved')
       and coalesce(bt.posted_date, bt.date) between p_from and p_to
       and clickbooks_us.has_piecewise(bt.id)
     order by 2, 1
  loop
    if exists(select 1 from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'bank_transaction'
                and jj.source_id like t.id::text || ':%'  and jj.source_id ~ ':d[0-9]+$'
                and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) then
      already := already + 1; continue;
    end if;
    if b.locked_through is not null and t.d <= b.locked_through then locked_n := locked_n + 1; continue; end if;
    -- never twice: an older whole-category or payment entry that is still live blocks it
    if exists(select 1 from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'bank_transaction'
                and (jj.source_id = t.id::text or jj.source_id like t.id::text || ':r%')
                and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id))
       or exists(select 1 from public.accounting_invoice_payments p
                   join clickbooks_us.journals jj on jj.book_id = b.id and jj.source_kind = 'accounting_invoice_payment'
                    and (jj.source_id = p.id::text or jj.source_id like p.id::text || ':r%')
                  where p.bank_transaction_id = t.id and p.voided is not true
                    and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) then
      waiting := jsonb_set(waiting, array['an earlier entry for it is still live'], to_jsonb(coalesce((waiting->>'an earlier entry for it is still live')::int, 0) + 1));
      continue;
    end if;
    res := clickbooks_us.deposit_lines(b.id, t.id);
    if not coalesce((res->>'ok')::boolean, false) then
      why := coalesce(res->>'why', '?');
      if why not like 'paid in full%' and why not like 'whole-category%' then
        waiting := jsonb_set(waiting, array[why], to_jsonb(coalesce((waiting->>why)::int, 0) + 1));
      end if;
      continue;
    end if;
    select count(*) into prior_n from clickbooks_us.journals jj
     where jj.book_id = b.id and jj.source_kind = 'bank_transaction' and jj.source_id like t.id::text || ':d%';
    select jsonb_agg(jsonb_build_object('account_id', v->>0, 'debit_cents', v->>1, 'credit_cents', v->>2)) into lines
      from jsonb_array_elements(res->'lines') v;
    begin
      perform clickbooks_us.post_journal(b.id, t.d, 'Split / partly-placed bank transaction ' || t.id::text || ' (booked whole)',
        'bank_transaction', t.id::text || ':d' || prior_n::text, lines, p_actor);
      posted := posted + 1;
    exception when others then
      errors := errors || jsonb_build_array(jsonb_build_object('transaction', t.id, 'error', SQLERRM));
    end;
  end loop;

  result := jsonb_build_object('from', p_from, 'to', p_to, 'depositsPosted', posted, 'depositsReversed', reversed,
    'alreadyPosted', already, 'lockedPeriod', locked_n, 'waiting', waiting, 'errors', errors);
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('deposit_sync_completed', p_actor, result);
  return result;
end $$;

-- ── (3) bills a related company (NextTrade) paid for us ────────────────────
create or replace function clickbooks_us.affbill_lines(p_book uuid, p_pay uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v record; bl record; due uuid; cat uuid; n bigint;
begin
  select vp.* into v from public.vendor_bill_payments vp where vp.id = p_pay;
  if not found then return jsonb_build_object('ok', false, 'why', 'bill payment no longer in the hub'); end if;
  if v.voided is true then return jsonb_build_object('ok', false, 'why', 'bill payment voided'); end if;
  if coalesce(v.method, '') <> 'rtm' then return jsonb_build_object('ok', false, 'why', 'not paid through another company'); end if;
  select vb.* into bl from public.vendor_bills vb where vb.id = v.bill_id;
  if not found or bl.record_status is distinct from 'active' then return jsonb_build_object('ok', false, 'why', 'bill voided or deleted'); end if;
  due := clickbooks_us.affiliate_due_account(p_book, coalesce(nullif(trim(bl.paid_via), ''), 'RTM Capital'));
  if due is null then return jsonb_build_object('ok', false, 'why', 'paid through a service provider (stays one line)'); end if;
  cat := clickbooks_us.category_account(p_book, bl.category);
  if cat is null then return jsonb_build_object('ok', false, 'why', 'bill has no category with a ledger account'); end if;
  n := round(v.amount * 100)::bigint;
  if n <= 0 then return jsonb_build_object('ok', false, 'why', 'zero amount'); end if;
  return jsonb_build_object('ok', true, 'date', v.paid_date, 'lines', (
    select jsonb_agg(x order by x->>0, (x->>1)::bigint, (x->>2)::bigint) from (
      select jsonb_build_array(cat::text, n, 0) as x union all select jsonb_build_array(due::text, 0, n)) q));
end $$;

create or replace function clickbooks_us.affiliate_bill_sync_run(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype;
  j record; v record; res jsonb; have jsonb; why text; pid text; prior_n int; lines jsonb;
  posted int := 0; reversed int := 0; locked_n int := 0; waiting jsonb := '{}'::jsonb; errors jsonb := '[]'::jsonb; result jsonb;
begin
  if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US' for update;
  select * into strict c from clickbooks_us.cutover_control where singleton for update;
  if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
  if b.opening_cutoff is null or p_from <= b.opening_cutoff or p_from > p_to or p_to > current_date + 1 or p_to - p_from > 31 then raise exception 'CB_SHADOW_PERIOD'; end if;
  if to_regclass('public.vendor_bill_payments') is null then return jsonb_build_object('skipped', 'no bills table'); end if;

  for j in
    select jj.* from clickbooks_us.journals jj
     where jj.book_id = b.id and jj.status = 'posted' and jj.source_kind = 'manual' and jj.source_id like 'affbill:%'
       and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)
     order by jj.entry_date, jj.id
  loop
    pid := substring(j.source_id from 9 for 36);
    res := clickbooks_us.affbill_lines(b.id, pid::uuid);
    select jsonb_agg(jsonb_build_array(l.account_id::text, l.debit_cents, l.credit_cents) order by l.account_id::text, l.debit_cents, l.credit_cents)
      into have from clickbooks_us.journal_lines l where l.journal_id = j.id;
    if coalesce((res->>'ok')::boolean, false) and res->'lines' = have and (res->>'date')::date = j.entry_date then continue; end if;
    why := coalesce(res->>'why', 'bill category, amount or date changed');
    if b.locked_through is not null and j.entry_date <= b.locked_through then locked_n := locked_n + 1; continue; end if;
    begin
      perform clickbooks_us.reverse_journal(j.id, j.entry_date, left('Hub changed: ' || why || ' (bill payment ' || pid || ')', 1800), p_actor);
      reversed := reversed + 1;
    exception when others then errors := errors || jsonb_build_array(jsonb_build_object('journal', j.id, 'error', SQLERRM));
    end;
  end loop;

  for v in
    select vp.id, vp.paid_date from public.vendor_bill_payments vp
     where coalesce(vp.method, '') = 'rtm' and vp.voided is not true and vp.paid_date between p_from and p_to
     order by vp.paid_date, vp.id
  loop
    if exists(select 1 from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'manual'
                and (jj.source_id = 'affbill:' || v.id::text or jj.source_id like 'affbill:' || v.id::text || ':r%')
                and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) then continue; end if;
    if b.locked_through is not null and v.paid_date <= b.locked_through then locked_n := locked_n + 1; continue; end if;
    res := clickbooks_us.affbill_lines(b.id, v.id);
    if not coalesce((res->>'ok')::boolean, false) then
      why := coalesce(res->>'why', '?');
      if why not like 'paid through a service provider%' then waiting := jsonb_set(waiting, array[why], to_jsonb(coalesce((waiting->>why)::int, 0) + 1)); end if;
      continue;
    end if;
    select count(*) into prior_n from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'manual' and jj.source_id like 'affbill:' || v.id::text || '%';
    select jsonb_agg(jsonb_build_object('account_id', x->>0, 'debit_cents', x->>1, 'credit_cents', x->>2)) into lines from jsonb_array_elements(res->'lines') x;
    begin
      perform clickbooks_us.post_journal(b.id, v.paid_date, 'Bill paid for us by a related company — bill payment ' || v.id::text,
        'manual', 'affbill:' || v.id::text || case when prior_n = 0 then '' else ':r' || prior_n::text end, lines, p_actor);
      posted := posted + 1;
    exception when others then errors := errors || jsonb_build_array(jsonb_build_object('payment', v.id, 'error', SQLERRM));
    end;
  end loop;

  result := jsonb_build_object('from', p_from, 'to', p_to, 'billsPosted', posted, 'billsReversed', reversed,
    'lockedPeriod', locked_n, 'waiting', waiting, 'errors', errors);
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('affiliate_bill_sync_completed', p_actor, result);
  return result;
end $$;

-- ── (2) every hub bank account gets its ledger bank account ───────────────
create or replace function clickbooks_us.bank_map_sync_run(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; r record; acc record; tok text; twin uuid; twin_src text; acct uuid; nm text;
  reused int := 0; created int := 0; skipped jsonb := '[]'::jsonb; result jsonb;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US' for update;
  if b.opening_cutoff is null then return jsonb_build_object('skipped', 'no opening cutoff yet'); end if;
  for r in
    select distinct bt.account_id from public.bank_transactions bt
     where bt.wave_business_id = b.wave_business_id and bt.account_id is not null and bt.iso_currency = 'USD'
       and coalesce(bt.posted_date, bt.date) > b.opening_cutoff
       and not exists(select 1 from clickbooks_us.bank_ledger_map m where m.book_id = b.id and m.provider_account_id = bt.account_id)
     order by 1
  loop
    select pa.name, pa.mask, pa.type, bc.institution_name into acc
      from public.plaid_accounts pa left join public.bank_connections bc on bc.id = pa.connection_id
     where pa.plaid_account_id = r.account_id limit 1;
    if not found then skipped := skipped || jsonb_build_array(jsonb_build_object('account', r.account_id, 'why', 'not in the hub account list')); continue; end if;
    if coalesce(acc.type, 'depository') <> 'depository' then
      skipped := skipped || jsonb_build_array(jsonb_build_object('account', r.account_id, 'why', 'card or loan — needs a liability account, set by the accountant')); continue;
    end if;
    tok := lower(substring(coalesce(acc.institution_name, '') from '[A-Za-z0-9]+'));
    twin := null; twin_src := null;
    if acc.mask is not null and coalesce(tok, '') <> '' then
      select m.account_id, m.provider_account_id into twin, twin_src
        from clickbooks_us.bank_ledger_map m
        join public.plaid_accounts p2 on p2.plaid_account_id = m.provider_account_id
        left join public.bank_connections c2 on c2.id = p2.connection_id
        join clickbooks_us.accounts a on a.id = m.account_id and a.book_id = m.book_id
       where m.book_id = b.id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive
         and p2.mask = acc.mask and lower(substring(coalesce(c2.institution_name, '') from '[A-Za-z0-9]+')) = tok
       order by m.provider_account_id limit 1;
    end if;
    if twin is not null then
      insert into clickbooks_us.bank_ledger_map(book_id, provider_account_id, account_id, reviewed, evidence)
      values (b.id, r.account_id, twin, true, 'auto (RB): same real account as ' || twin_src || ' (same bank + last 4 ' || acc.mask || ')')
      on conflict (book_id, provider_account_id) do nothing;
      reused := reused + 1; continue;
    end if;
    nm := left(coalesce(nullif(trim(acc.institution_name), ''), 'Bank') || ' — ' || coalesce(nullif(trim(acc.name), ''), 'account') || coalesce(' ••' || acc.mask, ''), 200);
    begin
      insert into clickbooks_us.accounts(book_id, code, name, account_type, normal_side, is_bank_sensitive, is_active, needs_review, origin)
      values (b.id, 'B-' || md5(r.account_id), nm, 'asset', 'debit', true, true, false, 'manual')
      on conflict (book_id, code) do nothing;
      select a.id into acct from clickbooks_us.accounts a where a.book_id = b.id and a.code = 'B-' || md5(r.account_id) and a.is_active and not a.needs_review;
      if acct is null then
        skipped := skipped || jsonb_build_array(jsonb_build_object('account', r.account_id, 'why', 'its ledger account is flagged for review'));
      else
        insert into clickbooks_us.bank_ledger_map(book_id, provider_account_id, account_id, reviewed, evidence)
        values (b.id, r.account_id, acct, true, 'auto (RB): ledger bank account created for ' || nm || ' — activity after the opening cutoff')
        on conflict (book_id, provider_account_id) do nothing;
        created := created + 1;
      end if;
    exception when others then
      skipped := skipped || jsonb_build_array(jsonb_build_object('account', r.account_id, 'why', SQLERRM));
    end;
  end loop;
  result := jsonb_build_object('reusedTwin', reused, 'created', created, 'skipped', skipped);
  if reused + created > 0 or jsonb_array_length(skipped) > 0 then
    insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('bank_map_sync_completed', p_actor, result);
  end if;
  return result;
end $$;

-- Opening balance of a bank account added after the cutoff (M&T, PNC…), as of
-- the opening cutoff date, from your bank statement. Run it yourself in the
-- SQL Editor, once per account, e.g.:
--   select public.clickbooks_us_bank_opening_balance('PNC', '1234', 15230.55);
create or replace function public.clickbooks_us_bank_opening_balance(p_bank text, p_last4 text, p_balance numeric) returns text
language plpgsql security definer set search_path='' as $$
declare b clickbooks_us.books%rowtype; tok text; n int; acct uuid; off uuid; amt bigint; lines jsonb;
begin
  select * into strict b from clickbooks_us.books where code = 'KTC_US';
  tok := lower(substring(coalesce(p_bank, '') from '[A-Za-z0-9]+'));
  select count(distinct m.account_id), (array_agg(distinct m.account_id))[1] into n, acct
    from clickbooks_us.bank_ledger_map m
    join public.plaid_accounts pa on pa.plaid_account_id = m.provider_account_id
    left join public.bank_connections bc on bc.id = pa.connection_id
   where m.book_id = b.id and m.reviewed and pa.mask = trim(p_last4)
     and lower(substring(coalesce(bc.institution_name, '') from '[A-Za-z0-9]+')) = tok;
  if n = 0 then return 'No ledger bank account for ' || p_bank || ' ••' || p_last4 || ' yet — it is created by the 15-minute run once its transactions are in the hub. Try again after that.'; end if;
  if n > 1 then return 'More than one ledger account matches ' || p_bank || ' ••' || p_last4 || ' — nothing recorded; ask Claude.'; end if;
  if exists(select 1 from clickbooks_us.journals j where j.book_id = b.id and j.source_kind = 'opening_balance' and j.source_id = 'bank-open:' || acct::text) then
    return 'An opening balance is already recorded for ' || p_bank || ' ••' || p_last4 || ' — nothing changed.';
  end if;
  amt := round(abs(coalesce(p_balance, 0)) * 100)::bigint;
  if amt = 0 then return 'Zero balance — nothing to record.'; end if;
  select a.id into off from clickbooks_us.accounts a where a.book_id = b.id and a.code = '3000';
  -- your explicit act approves the opening-balance offset account (reconciled by the accountant)
  update clickbooks_us.accounts set needs_review = false where id = off and needs_review;
  if p_balance > 0 then
    lines := jsonb_build_array(jsonb_build_object('account_id', acct, 'debit_cents', amt::text, 'credit_cents', '0'),
                               jsonb_build_object('account_id', off,  'debit_cents', '0', 'credit_cents', amt::text));
  else
    lines := jsonb_build_array(jsonb_build_object('account_id', acct, 'debit_cents', '0', 'credit_cents', amt::text),
                               jsonb_build_object('account_id', off,  'debit_cents', amt::text, 'credit_cents', '0'));
  end if;
  perform clickbooks_us.post_journal(b.id, b.opening_cutoff, 'Opening balance ' || p_bank || ' ••' || p_last4 || ' on ' || b.opening_cutoff::text || ' (from the bank statement)',
    'opening_balance', 'bank-open:' || acct::text, lines, null);
  insert into clickbooks_us.workflow_events(kind, details) values ('bank_opening_balance_recorded', jsonb_build_object('bank', p_bank, 'last4', p_last4, 'balance', p_balance));
  return 'Recorded: ' || p_bank || ' ••' || p_last4 || ' opening balance ' || p_balance::text || ' on ' || b.opening_cutoff::text || '.';
end $$;
revoke all on function public.clickbooks_us_bank_opening_balance(text, text, numeric) from public, anon, authenticated, service_role;

-- ── service wrappers for the 15-minute job (service role only) ─────────────
create or replace function public.clickbooks_us_bank_map_job(p_actor uuid) returns jsonb
language sql security definer set search_path='' as $$ select clickbooks_us.bank_map_sync_run(p_actor) $$;
create or replace function public.clickbooks_us_ledger_extras_job(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r1 jsonb; r2 jsonb;
begin
  begin r1 := clickbooks_us.deposit_sync_run(p_from, p_to, p_actor); exception when others then r1 := jsonb_build_object('error', SQLERRM); end;
  begin r2 := clickbooks_us.affiliate_bill_sync_run(p_from, p_to, p_actor); exception when others then r2 := jsonb_build_object('error', SQLERRM); end;
  return jsonb_build_object('deposits', r1, 'affiliate_bills', r2);
end $$;
revoke all on function public.clickbooks_us_bank_map_job(uuid) from public, anon, authenticated;
revoke all on function public.clickbooks_us_ledger_extras_job(date, date, uuid) from public, anon, authenticated;
grant execute on function public.clickbooks_us_bank_map_job(uuid) to service_role;
grant execute on function public.clickbooks_us_ledger_extras_job(date, date, uuid) to service_role;

-- ── (4) engine rule path: never re-use a transaction that already had an entry
-- Copy of clickbooks/p58/19 shadow_sync_run with ONE change in the rule loop: a
-- transaction that already had any bank-transaction entry (even a reversed
-- one) is skipped, instead of colliding on post_journal's source identity.
create or replace function clickbooks_us.shadow_sync_run(p_from date,p_to date,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text; ar uuid; income uuid; i record; p record; q record; bank record; bank_gl uuid; lines jsonb; jid uuid; invoice_posted int:=0; payment_posted int:=0; rules_posted int:=0; skipped int:=0; result jsonb; snapshot text; alloc jsonb; alloc_lines jsonb; n bigint; opening_remaining bigint; prior_paid bigint; begin
 if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
 if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US' for update; select * into strict c from clickbooks_us.cutover_control where singleton for update; src:=b.wave_business_id;
 if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
 if b.opening_cutoff is null or p_from<=b.opening_cutoff or p_from>p_to or p_to>current_date+1 or p_to-p_from>31 then raise exception 'CB_SHADOW_PERIOD'; end if;
 select id into strict ar from clickbooks_us.accounts where book_id=b.id and code='1100';
 select d.invoice_income_account_id into income from clickbooks_us.posting_defaults d join clickbooks_us.accounts a on a.id=d.invoice_income_account_id and a.book_id=d.book_id where d.book_id=b.id and d.reviewed and a.is_active and not a.needs_review and a.account_type='income';
 if income is null then raise exception 'CB_POSTING_DEFAULT_ACCOUNT'; end if;
 snapshot:=md5(clickbooks_us.source_snapshot(p_to)::text);
 for i in select * from public.accounting_invoices x where x.wave_business_id=src and x.currency='USD' and x.record_status='active' and x.approval_status='approved' and x.invoice_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=x.id::text) order by x.invoice_date,x.id loop
  if not exists(select 1 from public.accounting_invoice_items li where li.invoice_id=i.id)
   or coalesce(i.total_amount,0)<=0 or coalesce(i.amount_paid,0)<0 or coalesce(i.amount_paid,0)>coalesce(i.total_amount,0)
   or coalesce(i.total_amount,0)<>(select coalesce(sum(li.line_total),0) from public.accounting_invoice_items li where li.invoice_id=i.id)
   or coalesce(i.amount_paid,0)<>(select coalesce(sum(pp.amount),0) from public.accounting_invoice_payments pp where pp.accounting_invoice_id=i.id and pp.wave_business_id=src and pp.voided is not true)
  then skipped:=skipped+1; continue; end if;
  n:=clickbooks_us.money_cents(i.total_amount::text); lines:=jsonb_build_array(jsonb_build_object('account_id',ar,'debit_cents',n::text,'credit_cents','0'),jsonb_build_object('account_id',income,'debit_cents','0','credit_cents',n::text));
  perform clickbooks_us.post_journal(b.id,i.invoice_date,'Invoice '||coalesce(i.invoice_number,i.id::text),'accounting_invoice',i.id::text,lines,p_actor); invoice_posted:=invoice_posted+1;
 end loop;
 for p in select pp.* from public.accounting_invoice_payments pp join public.accounting_invoices ii on ii.id=pp.accounting_invoice_id and ii.wave_business_id=src and ii.currency='USD' where pp.wave_business_id=src and pp.voided is not true and pp.payment_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice_payment' and j.source_id=pp.id::text) order by pp.payment_date,pp.id loop
  if not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=p.accounting_invoice_id::text and j.status='posted')
     and not exists(select 1 from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id=o.run_id and mr.state='committed' where o.book_id=b.id and o.kind='receivable' and o.source_ref=p.accounting_invoice_id::text)
  then skipped:=skipped+1; continue; end if;
  select t.* into bank from public.bank_transactions t where t.id=p.bank_transaction_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD' and t.direction='in'; if not found then skipped:=skipped+1; continue; end if;
  if (select coalesce(sum(pp.amount),0) from public.accounting_invoice_payments pp where pp.bank_transaction_id=bank.id and pp.wave_business_id=src and pp.voided is not true) is distinct from bank.amount_abs then skipped:=skipped+1; continue; end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=bank.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive; if bank_gl is null then skipped:=skipped+1; continue; end if;
  select o.amount_cents into opening_remaining from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id=o.run_id and mr.state='committed' where o.book_id=b.id and o.kind='receivable' and o.source_ref=p.accounting_invoice_id::text limit 1;
  if opening_remaining is not null then
    select coalesce(sum(l.credit_cents-l.debit_cents),0)::bigint into prior_paid from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id where j.book_id=b.id and j.status='posted' and j.source_kind='accounting_invoice_payment' and l.account_id=ar and j.entry_date>b.opening_cutoff and exists(select 1 from public.accounting_invoice_payments px where px.id::text=j.source_id and px.accounting_invoice_id=p.accounting_invoice_id);
    if prior_paid+clickbooks_us.money_cents(p.amount::text)>opening_remaining then skipped:=skipped+1; continue; end if;
  end if;
  n:=clickbooks_us.money_cents(p.amount::text); lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents',n::text,'credit_cents','0'),jsonb_build_object('account_id',ar,'debit_cents','0','credit_cents',n::text));
  perform clickbooks_us.post_journal(b.id,p.payment_date,'Invoice payment '||p.id::text,'accounting_invoice_payment',p.id::text,lines,p_actor); payment_posted:=payment_posted+1;
 end loop;
 for q in select qp.*,r.enabled,r.revision current_revision from clickbooks_us.rule_proposals qp join clickbooks_us.rules r on r.id=qp.rule_id where qp.book_id=b.id and qp.state='approved' and qp.posted_journal_id is null order by qp.created_at,qp.id loop
  if not q.enabled or q.rule_revision<>q.current_revision or q.outcome->>'kind'<>'categorize' then skipped:=skipped+1; continue; end if;
  select t.* into bank from public.bank_transactions t where t.id=q.source_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD' and t.review_status='unreviewed' and t.classification is null and t.linked_id is null and t.matched_invoice_id is null and not exists(select 1 from clickbooks_us.journals jx where jx.book_id=b.id and jx.source_kind='bank_transaction' and (jx.source_id=t.id::text or jx.source_id like t.id::text||':%')); if not found or coalesce(bank.posted_date,bank.date) not between p_from and p_to then continue; end if;
  if md5((select value::text from jsonb_array_elements(clickbooks_us.source_snapshot(p_to)->'bank') where value->>'id'=bank.id::text))<>q.source_hash then skipped:=skipped+1; continue; end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=bank.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive; if bank_gl is null then skipped:=skipped+1; continue; end if;
  n:=clickbooks_us.money_cents(bank.amount_abs::text); alloc_lines:='[]'::jsonb;
  for alloc in select value from jsonb_array_elements(q.outcome->'allocations') loop
   if not exists(select 1 from clickbooks_us.accounts a where a.book_id=b.id and a.id=(alloc->>'accountId')::uuid and a.is_active and not a.needs_review and not a.is_bank_sensitive) then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if;
   if bank.direction='out' then alloc_lines:=alloc_lines||jsonb_build_array(jsonb_build_object('account_id',alloc->>'accountId','debit_cents',alloc->>'amountCents','credit_cents','0')); else alloc_lines:=alloc_lines||jsonb_build_array(jsonb_build_object('account_id',alloc->>'accountId','debit_cents','0','credit_cents',alloc->>'amountCents')); end if;
  end loop;
  if bank.direction='out' then lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents','0','credit_cents',n::text))||alloc_lines; else lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents',n::text,'credit_cents','0'))||alloc_lines; end if;
  jid:=clickbooks_us.post_journal(b.id,coalesce(bank.posted_date,bank.date),'Rule-classified bank transaction '||bank.id::text,'bank_transaction',bank.id::text,lines,p_actor); update clickbooks_us.rule_proposals set posted_journal_id=jid where id=q.id; rules_posted:=rules_posted+1;
 end loop;
 result:=jsonb_build_object('from',p_from,'to',p_to,'invoicesPosted',invoice_posted,'paymentsPosted',payment_posted,'ruleBankTransactionsPosted',rules_posted,'skippedForReview',skipped,'sourceFingerprint',snapshot);
 insert into clickbooks_us.shadow_sync_runs(from_date,to_date,source_fingerprint,result,actor_id) values(p_from,p_to,snapshot,result,p_actor);
 insert into clickbooks_us.workflow_events(kind,actor_id,details) values('shadow_sync_completed',p_actor,result); return result;
end $$;

select 'RB ledger completion installed: deposits, bank accounts, NextTrade advances, engine guard' as result;
