-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SK — MONTH-END: reconcile each bank account to its statement, then close (lock) the month.
-- Max, Nov 13 12:50: "we should be able to reconcile things at month-end ... create something for the bank reconciliation"
-- · 12:52: "work on top 2 right now, top 3, and let's move forward."
--
-- Plain words:
--   RECONCILE — you type the statement's ending balance for a bank account and a date; the ledger's balance for that
--               account on that date is compared to the cent. Equal → reconciled. Not equal → the difference is shown with
--               the bank lines that are not on the books yet. NOTHING is ever adjusted to force the two to agree.
--   CLOSE     — when every bank account that has activity is reconciled to that month-end, the super admin closes the
--               month. The ledger then refuses any entry dated in it (the core already enforces locked_through).
--   REOPEN    — super admin only, with a written reason; kept in the event log.
-- Additive: one new table, new functions. No existing function is changed. Safe to run again. Needs RB.
-- ═══════════════════════════════════════════════════════════════════════════
DO $sk$
BEGIN
IF to_regnamespace('clickbooks_us') IS NULL OR to_regclass('clickbooks_us.bank_ledger_map') IS NULL THEN
  RAISE NOTICE 'SK: the ClickBooks ledger is not installed here — nothing was changed.';
  RETURN;
END IF;

CREATE TABLE IF NOT EXISTS clickbooks_us.bank_reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES clickbooks_us.books(id),
  account_id uuid NOT NULL,
  statement_date date NOT NULL,
  statement_cents bigint NOT NULL,
  ledger_cents bigint NOT NULL,
  difference_cents bigint NOT NULL,
  reconciled boolean NOT NULL,
  note text,
  actor_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (difference_cents = statement_cents - ledger_cents),
  CHECK (reconciled = (difference_cents = 0)),
  FOREIGN KEY (book_id, account_id) REFERENCES clickbooks_us.accounts(book_id, id)
);
CREATE INDEX IF NOT EXISTS cb_us_recon_acct_date ON clickbooks_us.bank_reconciliations(account_id, statement_date, id DESC);
DROP TRIGGER IF EXISTS cb_us_recon_append_only ON clickbooks_us.bank_reconciliations;
CREATE TRIGGER cb_us_recon_append_only BEFORE UPDATE OR DELETE ON clickbooks_us.bank_reconciliations FOR EACH ROW EXECUTE FUNCTION clickbooks_us.deny_mutation();
ALTER TABLE clickbooks_us.bank_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clickbooks_us.bank_reconciliations FROM public, anon, authenticated;

-- the ledger's balance of one account at the end of a day, in cents (posted entries only; an asset is debit − credit)
EXECUTE $def$
create or replace function clickbooks_us.account_balance_cents(p_account uuid, p_date date) returns bigint
language sql stable security invoker set search_path='' as $$
  select coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint
    from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id = l.journal_id
   where l.account_id = p_account and j.status = 'posted' and j.entry_date <= p_date
$$;
$def$;

-- every bank ledger account: ledger balance on the date, its latest reconciliation for that date, and what the bank feed has
-- up to that date that is NOT on the books yet (the usual reason for a difference)
EXECUTE $def$
create or replace function public.clickbooks_us_recon_overview(p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b record; out jsonb := '[]'::jsonb; a record; rec record; miss_n int; miss_c bigint; miss jsonb; led bigint; act int;
begin
  select * into b from clickbooks_us.books where code = 'KTC_US';
  if not found then return jsonb_build_object('installed', false); end if;
  if p_date is null then raise exception 'Pick the statement date.'; end if;
  for a in
    select ac.id, ac.code, ac.name,
           (select array_agg(m.provider_account_id) from clickbooks_us.bank_ledger_map m where m.book_id = b.id and m.account_id = ac.id) as feeds
      from clickbooks_us.accounts ac
     where ac.book_id = b.id and ac.is_bank_sensitive and ac.is_active and ac.account_type = 'asset'
       and exists(select 1 from clickbooks_us.bank_ledger_map m where m.book_id = b.id and m.account_id = ac.id)
     order by ac.code
  loop
    led := clickbooks_us.account_balance_cents(a.id, p_date);
    select count(*) into act from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id = l.journal_id where l.account_id = a.id and j.status = 'posted';
    select r.* into rec from clickbooks_us.bank_reconciliations r where r.account_id = a.id and r.statement_date = p_date order by r.id desc limit 1;
    select count(*), coalesce(sum(case when t.direction = 'in' then round(t.amount_abs * 100) else -round(t.amount_abs * 100) end), 0)::bigint,
           coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'date', t.date, 'amount', case when t.direction = 'in' then t.amount_abs else -t.amount_abs end,
                    'name', left(coalesce(t.merchant_name, t.name, ''), 80), 'status', coalesce(t.review_status, 'not reviewed')) order by t.date, t.id) filter (where rn <= 40), '[]'::jsonb)
      into miss_n, miss_c, miss
      from (select t0.*, row_number() over (order by t0.date, t0.id) as rn from public.bank_transactions t0
             where t0.account_id = any(a.feeds) and t0.date > coalesce(b.opening_cutoff, date '1900-01-01') and t0.date <= p_date
               and coalesce(t0.pending, false) = false and coalesce(t0.review_status, '') <> 'duplicate'
               and not exists(select 1 from clickbooks_us.journals jj where jj.book_id = b.id and jj.status = 'posted'
                               and jj.source_kind in ('bank_transaction', 'accounting_invoice_payment', 'manual') and jj.source_id like t0.id::text || '%'
                               and not exists(select 1 from clickbooks_us.journals r2 where r2.reverses_id = jj.id))) t;
    out := out || jsonb_build_array(jsonb_build_object('account_id', a.id, 'code', a.code, 'name', a.name, 'ledger', led / 100.0, 'has_activity', act > 0,
      'statement', case when rec.id is null then null else rec.statement_cents / 100.0 end,
      'difference', case when rec.id is null then null else (rec.statement_cents - led) / 100.0 end,
      'reconciled', rec.id is not null and rec.statement_cents = led,
      'stale', rec.id is not null and rec.ledger_cents <> led,
      'saved_at', rec.recorded_at, 'note', rec.note,
      'not_on_books', jsonb_build_object('count', miss_n, 'total', miss_c / 100.0, 'lines', miss)));
  end loop;
  return jsonb_build_object('installed', true, 'date', p_date, 'opening_cutoff', b.opening_cutoff, 'locked_through', b.locked_through, 'accounts', out);
end $$;
$def$;

-- note: payments posted through the invoice path carry the PAYMENT id, not the bank line id, so a matched customer deposit
-- can show under "not on the books yet" although its money is in the ledger — it is a hint list, never used to decide.

EXECUTE $def$
create or replace function public.clickbooks_us_recon_save(p_account uuid, p_date date, p_statement numeric, p_note text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b record; a record; led bigint; st bigint;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US';
  select * into a from clickbooks_us.accounts ac where ac.id = p_account and ac.book_id = b.id and ac.is_bank_sensitive and ac.is_active;
  if not found then raise exception 'That is not an active bank account in the ledger.'; end if;
  if p_date is null or p_date > current_date then raise exception 'The statement date cannot be in the future.'; end if;
  if b.opening_cutoff is not null and p_date < b.opening_cutoff then raise exception 'The statement date is before the opening balance (%).', b.opening_cutoff; end if;
  if p_statement is null or abs(p_statement) > 9999999999 then raise exception 'Type the statement''s ending balance.'; end if;
  st := round(p_statement * 100)::bigint;
  led := clickbooks_us.account_balance_cents(a.id, p_date);
  insert into clickbooks_us.bank_reconciliations(book_id, account_id, statement_date, statement_cents, ledger_cents, difference_cents, reconciled, note, actor_id)
  values (b.id, a.id, p_date, st, led, st - led, st = led, nullif(left(trim(coalesce(p_note, '')), 500), ''), p_actor);
  insert into clickbooks_us.workflow_events(kind, object_id, actor_id, details)
  values ('bank_reconciliation_saved', a.id, p_actor, jsonb_build_object('account', a.code, 'date', p_date, 'statement', st / 100.0, 'ledger', led / 100.0, 'difference', (st - led) / 100.0, 'reconciled', st = led));
  return jsonb_build_object('ok', true, 'reconciled', st = led, 'statement', st / 100.0, 'ledger', led / 100.0, 'difference', (st - led) / 100.0);
end $$;
$def$;

EXECUTE $def$
create or replace function public.clickbooks_us_close_period(p_through date, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b clickbooks_us.books%rowtype; a record; rec record; led bigint; bad text := ''; n int := 0;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US' for update;
  if p_through is null or p_through <> (date_trunc('month', p_through) + interval '1 month - 1 day')::date then raise exception 'A month is closed at its last day — pick a month-end date.'; end if;
  if p_through >= current_date then raise exception 'That month is not over yet.'; end if;
  if b.opening_cutoff is not null and p_through < b.opening_cutoff then raise exception 'That is before the opening balance (%).', b.opening_cutoff; end if;
  if b.locked_through is not null and p_through <= b.locked_through then raise exception 'The books are already closed through %.', b.locked_through; end if;
  for a in
    select ac.id, ac.code, ac.name from clickbooks_us.accounts ac
     where ac.book_id = b.id and ac.is_bank_sensitive and ac.is_active and ac.account_type = 'asset'
       and exists(select 1 from clickbooks_us.bank_ledger_map m where m.book_id = b.id and m.account_id = ac.id)
       and exists(select 1 from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id = l.journal_id where l.account_id = ac.id and j.status = 'posted' and j.entry_date <= p_through)
     order by ac.code
  loop
    n := n + 1;
    led := clickbooks_us.account_balance_cents(a.id, p_through);
    select r.* into rec from clickbooks_us.bank_reconciliations r where r.account_id = a.id and r.statement_date = p_through order by r.id desc limit 1;
    if rec.id is null then bad := bad || a.name || ' — not reconciled yet; ';
    elsif rec.statement_cents <> led then bad := bad || a.name || ' — the statement and the books differ by $' || to_char(abs(rec.statement_cents - led) / 100.0, 'FM999,999,990.00') || '; ';
    end if;
  end loop;
  if bad <> '' then raise exception 'Cannot close %: %', p_through, left(bad, 900); end if;
  update clickbooks_us.books set locked_through = p_through where id = b.id;
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('period_closed', p_actor, jsonb_build_object('through', p_through, 'was', b.locked_through, 'bank_accounts', n));
  return jsonb_build_object('ok', true, 'locked_through', p_through, 'was', b.locked_through, 'bank_accounts', n);
end $$;
$def$;

EXECUTE $def$
create or replace function public.clickbooks_us_reopen_period(p_to date, p_reason text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b clickbooks_us.books%rowtype;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Say why the closed period is being reopened (at least 10 characters).'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US' for update;
  if b.locked_through is null then raise exception 'No period is closed.'; end if;
  if p_to is not null and p_to >= b.locked_through then raise exception 'To reopen, pick a date before %.', b.locked_through; end if;
  if p_to is not null and p_to <> (date_trunc('month', p_to) + interval '1 month - 1 day')::date then raise exception 'Pick a month-end date (the last month that stays closed), or none to reopen everything.'; end if;
  if p_to is not null and b.opening_cutoff is not null and p_to < b.opening_cutoff then p_to := null; end if;
  update clickbooks_us.books set locked_through = p_to where id = b.id;
  insert into clickbooks_us.workflow_events(kind, actor_id, details) values ('period_reopened', p_actor, jsonb_build_object('to', p_to, 'was', b.locked_through, 'reason', left(trim(p_reason), 500)));
  return jsonb_build_object('ok', true, 'locked_through', p_to, 'was', b.locked_through);
end $$;
$def$;

REVOKE ALL ON FUNCTION public.clickbooks_us_recon_overview(date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_recon_save(uuid, date, numeric, text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_close_period(date, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_reopen_period(date, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_recon_overview(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_recon_save(uuid, date, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_close_period(date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_reopen_period(date, text, uuid) TO service_role;
RAISE NOTICE 'SK ok — bank reconciliation and month-end close are installed.';
END $sk$;
