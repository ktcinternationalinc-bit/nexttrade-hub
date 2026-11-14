-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SJ — BILLS ON THE BOOKS BEFORE THEY ARE PAID (accounts payable)
-- Max, Nov 13 12:50: "of course, they're going to be put into the books before they're paid" · 12:52: "work on top 2 right
-- now, top 3, and let's move forward."
--
-- What it does, in plain words:
--   • the day a bill is VALIDATED the ledger records the cost and "we owe this vendor" (dated the bill date);
--   • the day it is paid, the debt is cleared.
--
-- HOW (purely additive — no existing posting function is changed):
--   bill   →  entry "apbill:<bill>"  : cost (and commission) up, Accounts payable up.
--   payment → entry "appay:<payment>": Accounts payable down, the same cost down — it cancels the cost the bank line
--             (or the related-company entry) books on the payment date, so the cost stays on the BILL date, once.
--   Every run re-checks its own entries: a bill changed / voided / un-validated → the entry is reversed and re-posted.
--
-- OFF until a start date is set (super admin, Accounting → Bills → Reports → "Bills on the books"). Only bills dated ON OR
-- AFTER that date are put on the books, so nothing already counted is counted again.
-- Bills paid through a SERVICE PROVIDER (RTM Capital) are left alone: that money is one line (professional fees) by design.
-- Safe to run again. Needs RB (ledger completion). RS (commission) is used when present.
-- ═══════════════════════════════════════════════════════════════════════════
DO $sj$
BEGIN
IF to_regnamespace('clickbooks_us') IS NULL OR to_regprocedure('clickbooks_us.affiliate_due_account(uuid,text)') IS NULL THEN
  RAISE NOTICE 'SJ: the ClickBooks ledger (RB) is not installed here — nothing was changed.';
  RETURN;
END IF;

CREATE TABLE IF NOT EXISTS clickbooks_us.payable_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  start_date date,
  set_by uuid,
  set_at timestamptz
);
INSERT INTO clickbooks_us.payable_settings(singleton) VALUES (true) ON CONFLICT DO NOTHING;
REVOKE ALL ON clickbooks_us.payable_settings FROM public, anon, authenticated;

EXECUTE $def$
create or replace function clickbooks_us.payable_account(p_book uuid) returns uuid
language sql stable security invoker set search_path='' as $$
  select a.id from clickbooks_us.accounts a where a.book_id = p_book and a.code = '2000' and a.is_active and not a.needs_review
$$;
$def$;

-- the commission part of p_cents on a bill (0 when the commission SQL is not installed)
EXECUTE $def$
create or replace function clickbooks_us.sj_commission_cents(p_bill uuid, p_cents bigint) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare cm bigint := 0;
begin
  if to_regprocedure('clickbooks_us.bill_commission_cents(uuid,bigint)') is null then return 0; end if;
  execute 'select clickbooks_us.bill_commission_cents($1, $2)' into cm using p_bill, p_cents;
  return coalesce(cm, 0);
end $$;
$def$;

-- what the ledger must hold for ONE bill: {"ok":true,"date":..,"lines":[[account,debit,credit],..]} or {"ok":false,"why":..}
EXECUTE $def$
create or replace function clickbooks_us.apbill_lines(p_book uuid, p_bill uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare bl record; st date; ap uuid; cat uuid; cacct uuid; n bigint; cm bigint; cut date;
begin
  select s.start_date into st from clickbooks_us.payable_settings s where s.singleton;
  if st is null then return jsonb_build_object('ok', false, 'why', 'bills on the books is switched off'); end if;
  select vb.* into bl from public.vendor_bills vb where vb.id = p_bill;
  if not found or bl.record_status is distinct from 'active' then return jsonb_build_object('ok', false, 'why', 'bill voided or deleted'); end if;
  if bl.validation_status is distinct from 'validated' then return jsonb_build_object('ok', false, 'why', 'bill is not validated'); end if;
  if bl.bill_date is null then return jsonb_build_object('ok', false, 'why', 'bill has no date'); end if;
  if bl.bill_date < st then return jsonb_build_object('ok', false, 'why', 'bill dated before the start date'); end if;
  select b.opening_cutoff into cut from clickbooks_us.books b where b.id = p_book;
  if cut is not null and bl.bill_date <= cut then return jsonb_build_object('ok', false, 'why', 'bill dated before the opening balance'); end if;
  if nullif(trim(coalesce(bl.paid_via, '')), '') is not null and clickbooks_us.affiliate_due_account(p_book, bl.paid_via) is null then
    return jsonb_build_object('ok', false, 'why', 'paid through a service provider (stays one line)');
  end if;
  ap := clickbooks_us.payable_account(p_book);
  if ap is null then return jsonb_build_object('ok', false, 'why', 'the Accounts payable account is not approved yet'); end if;
  cat := clickbooks_us.category_account(p_book, bl.category);
  if cat is null then return jsonb_build_object('ok', false, 'why', 'bill has no category with a ledger account'); end if;
  n := round(coalesce(bl.total_amount, 0) * 100)::bigint;
  if n <= 0 then return jsonb_build_object('ok', false, 'why', 'zero amount'); end if;
  cm := clickbooks_us.sj_commission_cents(bl.id, n);
  if cm > 0 then
    cacct := clickbooks_us.category_account(p_book, 'purchase_commission');
    if cacct is null then return jsonb_build_object('ok', false, 'why', 'the commission account is not approved yet'); end if;
  end if;
  return jsonb_build_object('ok', true, 'date', bl.bill_date, 'lines', (
    select jsonb_agg(x order by x->>0, (x->>1)::bigint, (x->>2)::bigint) from (
      select jsonb_build_array(cat::text, n - cm, 0) as x
      union all select jsonb_build_array(cacct::text, cm, 0) where cm > 0
      union all select jsonb_build_array(ap::text, 0, n)) q));
end $$;
$def$;

-- what the ledger must hold for ONE payment of a bill that is on the books
EXECUTE $def$
create or replace function clickbooks_us.appay_lines(p_book uuid, p_pay uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v record; bl record; ap uuid; cat uuid; cacct uuid; n bigint; cm bigint; booked boolean := false;
begin
  select vp.* into v from public.vendor_bill_payments vp where vp.id = p_pay;
  if not found then return jsonb_build_object('ok', false, 'why', 'bill payment no longer in the hub'); end if;
  if v.voided is true then return jsonb_build_object('ok', false, 'why', 'bill payment voided'); end if;
  if v.paid_date is null then return jsonb_build_object('ok', false, 'why', 'payment has no date'); end if;
  -- only while the bill itself still belongs on the books (switched off / voided / un-validated → this entry goes too, same run)
  if not coalesce((clickbooks_us.apbill_lines(p_book, v.bill_id)->>'ok')::boolean, false) then return jsonb_build_object('ok', false, 'why', 'the bill is no longer on the books'); end if;
  -- only for a bill that IS on the books right now
  if not exists(select 1 from clickbooks_us.journals jj where jj.book_id = p_book and jj.status = 'posted' and jj.source_kind = 'manual'
                  and (jj.source_id = 'apbill:' || v.bill_id::text or jj.source_id like 'apbill:' || v.bill_id::text || ':r%')
                  and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) then
    return jsonb_build_object('ok', false, 'why', 'the bill is not on the books');
  end if;
  -- only when the ledger already carries this payment''s cost (the bank line, or the related-company entry): never ahead of it
  if v.bank_transaction_id is not null and exists(select 1 from clickbooks_us.journals jj where jj.book_id = p_book and jj.status = 'posted'
        and jj.source_kind = 'bank_transaction' and jj.source_id like v.bank_transaction_id::text || '%'
        and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) and coalesce(v.method, '') <> 'rtm' then booked := true; end if;
  if exists(select 1 from clickbooks_us.journals jj where jj.book_id = p_book and jj.status = 'posted' and jj.source_kind = 'manual'
        and (jj.source_id = 'affbill:' || v.id::text or jj.source_id like 'affbill:' || v.id::text || ':r%')
        and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) then booked := true; end if;
  if not booked then return jsonb_build_object('ok', false, 'why', 'waiting for the payment''s bank line to reach the ledger'); end if;
  select vb.* into bl from public.vendor_bills vb where vb.id = v.bill_id;
  ap := clickbooks_us.payable_account(p_book);
  cat := clickbooks_us.category_account(p_book, bl.category);
  if ap is null or cat is null then return jsonb_build_object('ok', false, 'why', 'bill has no category with a ledger account'); end if;
  n := round(v.amount * 100)::bigint;
  if n <= 0 then return jsonb_build_object('ok', false, 'why', 'zero amount'); end if;
  cm := clickbooks_us.sj_commission_cents(bl.id, n);
  if cm > 0 then
    cacct := clickbooks_us.category_account(p_book, 'purchase_commission');
    if cacct is null then return jsonb_build_object('ok', false, 'why', 'the commission account is not approved yet'); end if;
  end if;
  return jsonb_build_object('ok', true, 'date', v.paid_date, 'lines', (
    select jsonb_agg(x order by x->>0, (x->>1)::bigint, (x->>2)::bigint) from (
      select jsonb_build_array(ap::text, n, 0) as x
      union all select jsonb_build_array(cat::text, 0, n - cm)
      union all select jsonb_build_array(cacct::text, 0, cm) where cm > 0) q));
end $$;
$def$;

EXECUTE $def$
create or replace function clickbooks_us.payable_sync_run(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; st date;
  j record; v record; res jsonb; have jsonb; why text; sid text; kind text; prior_n int; lines jsonb;
  bills_posted int := 0; pays_posted int := 0; reversed int := 0; locked_n int := 0; waiting jsonb := '{}'::jsonb; errors jsonb := '[]'::jsonb; result jsonb;
begin
  if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US' for update;
  select * into strict c from clickbooks_us.cutover_control where singleton for update;
  if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
  if b.opening_cutoff is null or p_from <= b.opening_cutoff or p_from > p_to or p_to > current_date + 1 or p_to - p_from > 31 then raise exception 'CB_SHADOW_PERIOD'; end if;
  if to_regclass('public.vendor_bills') is null or to_regclass('public.vendor_bill_payments') is null then return jsonb_build_object('skipped', 'no bills table'); end if;
  select s.start_date into st from clickbooks_us.payable_settings s where s.singleton;

  -- 1) every entry this job ever made is re-checked against the hub (also when switched off: then they are reversed)
  for j in
    select jj.* from clickbooks_us.journals jj
     where jj.book_id = b.id and jj.status = 'posted' and jj.source_kind = 'manual' and (jj.source_id like 'apbill:%' or jj.source_id like 'appay:%')
       and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)
     order by (jj.source_id like 'apbill:%'), jj.entry_date, jj.id       -- payments first, so a bill's entry is reversed after its payments'
  loop
    kind := case when j.source_id like 'apbill:%' then 'apbill' else 'appay' end;
    sid := substring(j.source_id from length(kind) + 2 for 36);
    res := case when kind = 'apbill' then clickbooks_us.apbill_lines(b.id, sid::uuid) else clickbooks_us.appay_lines(b.id, sid::uuid) end;
    select jsonb_agg(jsonb_build_array(l.account_id::text, l.debit_cents, l.credit_cents) order by l.account_id::text, l.debit_cents, l.credit_cents)
      into have from clickbooks_us.journal_lines l where l.journal_id = j.id;
    if coalesce((res->>'ok')::boolean, false) and res->'lines' = have and (res->>'date')::date = j.entry_date then continue; end if;
    why := coalesce(res->>'why', 'bill category, amount or date changed');
    if b.locked_through is not null and j.entry_date <= b.locked_through then locked_n := locked_n + 1; continue; end if;
    begin
      perform clickbooks_us.reverse_journal(j.id, j.entry_date, left('Hub changed: ' || why || ' (' || kind || ' ' || sid || ')', 1800), p_actor);
      reversed := reversed + 1;
    exception when others then errors := errors || jsonb_build_array(jsonb_build_object('journal', j.id, 'error', SQLERRM));
    end;
  end loop;

  if st is null then
    result := jsonb_build_object('from', p_from, 'to', p_to, 'off', true, 'reversed', reversed, 'lockedPeriod', locked_n, 'errors', errors);
    return result;
  end if;

  -- 2) bills → on the books
  for v in
    select vb.id, vb.bill_date from public.vendor_bills vb
     where vb.record_status = 'active' and vb.validation_status = 'validated' and vb.bill_date between greatest(p_from, st) and p_to
     order by vb.bill_date, vb.id
  loop
    if exists(select 1 from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'manual'
                and (jj.source_id = 'apbill:' || v.id::text or jj.source_id like 'apbill:' || v.id::text || ':r%')
                and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) then continue; end if;
    if b.locked_through is not null and v.bill_date <= b.locked_through then locked_n := locked_n + 1; continue; end if;
    res := clickbooks_us.apbill_lines(b.id, v.id);
    if not coalesce((res->>'ok')::boolean, false) then
      why := coalesce(res->>'why', '?');
      if why not like 'paid through a service provider%' then waiting := jsonb_set(waiting, array[why], to_jsonb(coalesce((waiting->>why)::int, 0) + 1)); end if;
      continue;
    end if;
    select count(*) into prior_n from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'manual' and jj.source_id like 'apbill:' || v.id::text || '%';
    select jsonb_agg(jsonb_build_object('account_id', x->>0, 'debit_cents', x->>1, 'credit_cents', x->>2)) into lines from jsonb_array_elements(res->'lines') x;
    begin
      perform clickbooks_us.post_journal(b.id, v.bill_date, 'Bill received — we owe the vendor (bill ' || v.id::text || ')',
        'manual', 'apbill:' || v.id::text || case when prior_n = 0 then '' else ':r' || prior_n::text end, lines, p_actor);
      bills_posted := bills_posted + 1;
    exception when others then errors := errors || jsonb_build_array(jsonb_build_object('bill', v.id, 'error', SQLERRM));
    end;
  end loop;

  -- 3) payments of bills that are on the books → the debt is cleared
  for v in
    select vp.id, vp.paid_date from public.vendor_bill_payments vp
     where vp.voided is not true and vp.paid_date between p_from and p_to
     order by vp.paid_date, vp.id
  loop
    if exists(select 1 from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'manual'
                and (jj.source_id = 'appay:' || v.id::text or jj.source_id like 'appay:' || v.id::text || ':r%')
                and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id)) then continue; end if;
    res := clickbooks_us.appay_lines(b.id, v.id);
    if not coalesce((res->>'ok')::boolean, false) then
      why := coalesce(res->>'why', '?');
      if why like 'waiting for%' then waiting := jsonb_set(waiting, array[why], to_jsonb(coalesce((waiting->>why)::int, 0) + 1)); end if;
      continue;
    end if;
    if b.locked_through is not null and v.paid_date <= b.locked_through then locked_n := locked_n + 1; continue; end if;
    select count(*) into prior_n from clickbooks_us.journals jj where jj.book_id = b.id and jj.source_kind = 'manual' and jj.source_id like 'appay:' || v.id::text || '%';
    select jsonb_agg(jsonb_build_object('account_id', x->>0, 'debit_cents', x->>1, 'credit_cents', x->>2)) into lines from jsonb_array_elements(res->'lines') x;
    begin
      perform clickbooks_us.post_journal(b.id, v.paid_date, 'Bill paid — the debt to the vendor is cleared (payment ' || v.id::text || ')',
        'manual', 'appay:' || v.id::text || case when prior_n = 0 then '' else ':r' || prior_n::text end, lines, p_actor);
      pays_posted := pays_posted + 1;
    exception when others then errors := errors || jsonb_build_array(jsonb_build_object('payment', v.id, 'error', SQLERRM));
    end;
  end loop;

  result := jsonb_build_object('from', p_from, 'to', p_to, 'start', st, 'billsOnBooks', bills_posted, 'paymentsCleared', pays_posted, 'reversed', reversed,
    'lockedPeriod', locked_n, 'waiting', waiting, 'errors', errors);
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('payable_sync_completed', p_actor, result);
  return result;
end $$;
$def$;

-- the 15-minute ledger job: the two existing steps exactly as before, plus payables LAST (each step fails on its own)
EXECUTE $def$
create or replace function public.clickbooks_us_ledger_extras_job(p_from date, p_to date, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r1 jsonb; r2 jsonb; r3 jsonb;
begin
  begin r1 := clickbooks_us.deposit_sync_run(p_from, p_to, p_actor); exception when others then r1 := jsonb_build_object('error', SQLERRM); end;
  begin r2 := clickbooks_us.affiliate_bill_sync_run(p_from, p_to, p_actor); exception when others then r2 := jsonb_build_object('error', SQLERRM); end;
  begin r3 := clickbooks_us.payable_sync_run(p_from, p_to, p_actor); exception when others then r3 := jsonb_build_object('error', SQLERRM); end;
  return jsonb_build_object('deposits', r1, 'affiliate_bills', r2, 'payables', r3);
end $$;
$def$;

-- status for the screen, and the switch (the API route lets only the super admin call the setter)
EXECUTE $def$
create or replace function public.clickbooks_us_payables_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b record; st date; ap uuid; bal bigint := 0; n_b int := 0; n_p int := 0; last jsonb;
begin
  select * into b from clickbooks_us.books where code = 'KTC_US';
  if not found then return jsonb_build_object('installed', false); end if;
  select s.start_date into st from clickbooks_us.payable_settings s where s.singleton;
  ap := clickbooks_us.payable_account(b.id);
  if ap is not null then
    select coalesce(sum(l.credit_cents - l.debit_cents), 0) into bal from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id = l.journal_id
     where l.account_id = ap and j.status = 'posted';
  end if;
  select count(*) filter (where jj.source_id like 'apbill:%'), count(*) filter (where jj.source_id like 'appay:%') into n_b, n_p
    from clickbooks_us.journals jj where jj.book_id = b.id and jj.status = 'posted' and jj.source_kind = 'manual' and (jj.source_id like 'apbill:%' or jj.source_id like 'appay:%')
     and not exists(select 1 from clickbooks_us.journals r where r.reverses_id = jj.id);
  select w.details into last from clickbooks_us.workflow_events w where w.kind = 'payable_sync_completed' order by w.id desc limit 1;
  return jsonb_build_object('installed', true, 'start_date', st, 'payable_account_ready', ap is not null, 'ledger_owed', bal / 100.0,
    'bills_on_books', n_b, 'payments_cleared', n_p, 'opening_cutoff', b.opening_cutoff, 'locked_through', b.locked_through, 'last_run', last);
end $$;
$def$;
EXECUTE $def$
create or replace function public.clickbooks_us_payables_set_start(p_start date, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b record; old date;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US';
  if p_start is not null and b.opening_cutoff is not null and p_start <= b.opening_cutoff then raise exception 'The start date must be after the opening balance date (%).', b.opening_cutoff; end if;
  if p_start is not null and b.locked_through is not null and p_start <= b.locked_through then raise exception 'The start date must be after the closed period (%).', b.locked_through; end if;
  if p_start is not null and clickbooks_us.payable_account(b.id) is null then raise exception 'The Accounts payable account (2000) is missing or not approved in the chart of accounts yet — approve it first.'; end if;
  select s.start_date into old from clickbooks_us.payable_settings s where s.singleton;
  update clickbooks_us.payable_settings set start_date = p_start, set_by = p_actor, set_at = now() where singleton;
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('payable_start_changed', p_actor, jsonb_build_object('from', old, 'to', p_start));
  return jsonb_build_object('ok', true, 'start_date', p_start, 'was', old);
end $$;
$def$;
REVOKE ALL ON FUNCTION public.clickbooks_us_ledger_extras_job(date, date, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_payables_status() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_payables_set_start(date, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_ledger_extras_job(date, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_payables_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_payables_set_start(date, uuid) TO service_role;
RAISE NOTICE 'SJ ok — bills on the books is installed and OFF until a start date is set.';
END $sj$;
