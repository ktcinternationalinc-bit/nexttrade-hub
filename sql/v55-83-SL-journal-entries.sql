-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SL — JOURNAL ENTRIES from a screen, with a second person's approval.
-- Max, Nov 13 12:50: "we should be able to do a journal entry. I agree." · 12:52: "work on top 2 right now, top 3".
--
-- Plain words: one person writes the entry (date, what it is for, the accounts, debits and credits that balance);
-- a DIFFERENT person approves it; only then does it go into the ledger. A wrong entry is never edited — a reversing
-- entry is written and approved the same way.
-- Not allowed here: bank accounts (they move only with real bank lines) and the control accounts for receivables,
-- payables and transfers (they are kept by invoices, bills and transfers) — a hand entry there would break their tie-out.
-- Additive: one new table, new functions; uses the ledger's own post_journal, so every core rule still applies
-- (balanced, period not closed, approved accounts only). Safe to run again. Needs the ClickBooks core.
-- ═══════════════════════════════════════════════════════════════════════════
DO $sl$
BEGIN
IF to_regnamespace('clickbooks_us') IS NULL OR to_regprocedure('clickbooks_us.post_journal(uuid,date,text,text,text,jsonb,uuid,uuid)') IS NULL THEN
  RAISE NOTICE 'SL: the ClickBooks ledger is not installed here — nothing was changed.';
  RETURN;
END IF;

CREATE TABLE IF NOT EXISTS clickbooks_us.manual_journal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  book_id uuid NOT NULL REFERENCES clickbooks_us.books(id),
  entry_date date NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 5 AND 500),
  lines jsonb NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_by uuid NOT NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decide_note text,
  journal_id uuid,
  reverses_request uuid,
  -- two-person rule, in the database: whoever approves or rejects is never the writer
  CHECK (status IN ('pending', 'cancelled') OR (decided_by IS NOT NULL AND decided_by <> created_by)),
  CHECK ((status = 'approved') = (journal_id IS NOT NULL))
);
ALTER TABLE clickbooks_us.manual_journal_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clickbooks_us.manual_journal_requests FROM public, anon, authenticated;

-- once decided (or cancelled) a request never changes again
EXECUTE $def$
create or replace function clickbooks_us.guard_mj_request() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP = 'DELETE' then raise exception 'CB_APPEND_ONLY: journal entry requests are kept'; end if;
  if OLD.status <> 'pending' then raise exception 'CB_IMMUTABLE: this journal entry request was already %', OLD.status; end if;
  if NEW.id <> OLD.id or NEW.created_by <> OLD.created_by or NEW.lines <> OLD.lines or NEW.entry_date <> OLD.entry_date or NEW.description <> OLD.description or NEW.total_cents <> OLD.total_cents then
    raise exception 'CB_IMMUTABLE: a journal entry request cannot be edited — cancel it and write a new one';
  end if;
  return NEW;
end $$;
$def$;
DROP TRIGGER IF EXISTS cb_us_guard_mj_request ON clickbooks_us.manual_journal_requests;
CREATE TRIGGER cb_us_guard_mj_request BEFORE UPDATE OR DELETE ON clickbooks_us.manual_journal_requests FOR EACH ROW EXECUTE FUNCTION clickbooks_us.guard_mj_request();

-- accounts a hand entry may use
EXECUTE $def$
create or replace function clickbooks_us.mj_account_ok(p_book uuid, p_account uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from clickbooks_us.accounts a where a.id = p_account and a.book_id = p_book and a.is_active and not a.needs_review
                 and not a.is_bank_sensitive and a.code not in ('1090', '1100', '2000'))
$$;
$def$;
EXECUTE $def$
create or replace function public.clickbooks_us_mj_accounts() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'type', a.account_type) order by a.account_type, a.name), '[]'::jsonb)
    from clickbooks_us.accounts a join clickbooks_us.books b on b.id = a.book_id and b.code = 'KTC_US'
   where clickbooks_us.mj_account_ok(b.id, a.id)
$$;
$def$;

-- checks shared by "write" and "approve" (the books may have changed in between)
EXECUTE $def$
create or replace function clickbooks_us.mj_check(p_book uuid, p_date date, p_lines jsonb) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare b record; x jsonb; d bigint := 0; c bigint := 0; ld bigint; lc bigint; n int := 0;
begin
  select * into strict b from clickbooks_us.books where id = p_book;
  if p_date is null then raise exception 'Pick the date of the entry.'; end if;
  if p_date > current_date then raise exception 'The date cannot be in the future.'; end if;
  if b.opening_cutoff is not null and p_date <= b.opening_cutoff then raise exception 'The date must be after the opening balance (%).', b.opening_cutoff; end if;
  if b.locked_through is not null and p_date <= b.locked_through then raise exception 'That month is closed (books closed through %). Date the entry after it.', b.locked_through; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'An entry needs at least two lines.'; end if;
  if jsonb_array_length(p_lines) > 40 then raise exception 'At most 40 lines in one entry.'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if (x->>'account_id') is null or not clickbooks_us.mj_account_ok(p_book, (x->>'account_id')::uuid) then
      raise exception 'Line %: that account cannot be used in a journal entry (bank accounts and the receivable / payable / transfer control accounts are kept by the system).', n; end if;
    ld := coalesce((x->>'debit_cents')::bigint, 0); lc := coalesce((x->>'credit_cents')::bigint, 0);
    if ld < 0 or lc < 0 or (ld > 0) = (lc > 0) then raise exception 'Line %: enter an amount in debit OR in credit, not both and not zero.', n; end if;
    d := d + ld; c := c + lc;
  end loop;
  if d <> c then raise exception 'The entry does not balance: debits % and credits % differ by %.', to_char(d / 100.0, 'FM999,999,990.00'), to_char(c / 100.0, 'FM999,999,990.00'), to_char(abs(d - c) / 100.0, 'FM999,999,990.00'); end if;
  return d;
end $$;
$def$;

EXECUTE $def$
create or replace function public.clickbooks_us_mj_create(p_date date, p_description text, p_lines jsonb, p_actor uuid, p_actor_name text, p_reverses uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b record; tot bigint; rid uuid; clean jsonb;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into strict b from clickbooks_us.books where code = 'KTC_US';
  if length(trim(coalesce(p_description, ''))) < 5 then raise exception 'Say what the entry is for (at least 5 characters).'; end if;
  tot := clickbooks_us.mj_check(b.id, p_date, p_lines);
  select jsonb_agg(jsonb_build_object('account_id', x->>'account_id', 'debit_cents', coalesce((x->>'debit_cents')::bigint, 0), 'credit_cents', coalesce((x->>'credit_cents')::bigint, 0),
                   'memo', nullif(left(trim(coalesce(x->>'memo', '')), 200), ''))) into clean from jsonb_array_elements(p_lines) x;
  if p_reverses is not null and not exists(select 1 from clickbooks_us.manual_journal_requests r where r.id = p_reverses and r.status = 'approved') then raise exception 'Only an approved entry can be reversed.'; end if;
  insert into clickbooks_us.manual_journal_requests(book_id, entry_date, description, lines, total_cents, created_by, created_by_name, reverses_request)
  values (b.id, p_date, left(trim(p_description), 500), clean, tot, p_actor, nullif(left(trim(coalesce(p_actor_name, '')), 120), ''), p_reverses) returning id into rid;
  insert into clickbooks_us.workflow_events(kind, object_id, actor_id, details) values ('manual_journal_requested', rid, p_actor, jsonb_build_object('date', p_date, 'total', tot / 100.0, 'reverses', p_reverses));
  return jsonb_build_object('ok', true, 'id', rid, 'total', tot / 100.0);
end $$;
$def$;

EXECUTE $def$
create or replace function public.clickbooks_us_mj_decide(p_id uuid, p_approve boolean, p_note text, p_actor uuid, p_actor_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r clickbooks_us.manual_journal_requests%rowtype; jid uuid; ls jsonb;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into r from clickbooks_us.manual_journal_requests where id = p_id for update;
  if not found then raise exception 'That journal entry request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'This entry was already %.', r.status; end if;
  if r.created_by = p_actor then raise exception 'A second person has to approve or reject it — not the person who wrote it.'; end if;
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Say why it is rejected (at least 5 characters).'; end if;
    update clickbooks_us.manual_journal_requests set status = 'rejected', decided_by = p_actor, decided_by_name = nullif(left(trim(coalesce(p_actor_name, '')), 120), ''), decided_at = now(), decide_note = left(trim(p_note), 500) where id = p_id;
    insert into clickbooks_us.workflow_events(kind, object_id, actor_id, details) values ('manual_journal_rejected', p_id, p_actor, jsonb_build_object('note', left(trim(p_note), 500)));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  perform clickbooks_us.mj_check(r.book_id, r.entry_date, r.lines);   -- the month may have been closed, an account retired, since it was written
  select jsonb_agg(jsonb_build_object('account_id', x->>'account_id', 'debit_cents', x->>'debit_cents', 'credit_cents', x->>'credit_cents', 'description', x->>'memo')) into ls from jsonb_array_elements(r.lines) x;
  jid := clickbooks_us.post_journal(r.book_id, r.entry_date, left('Journal entry JE-' || lpad(r.seq::text, 4, '0') || ': ' || r.description, 1900), 'manual', 'mj:' || r.id::text, ls, p_actor);
  update clickbooks_us.manual_journal_requests set status = 'approved', decided_by = p_actor, decided_by_name = nullif(left(trim(coalesce(p_actor_name, '')), 120), ''), decided_at = now(),
         decide_note = nullif(left(trim(coalesce(p_note, '')), 500), ''), journal_id = jid where id = p_id;
  insert into clickbooks_us.workflow_events(kind, object_id, actor_id, details) values ('manual_journal_approved', p_id, p_actor, jsonb_build_object('journal', jid, 'total', r.total_cents / 100.0));
  return jsonb_build_object('ok', true, 'status', 'approved', 'journal_id', jid);
end $$;
$def$;

EXECUTE $def$
create or replace function public.clickbooks_us_mj_cancel(p_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r clickbooks_us.manual_journal_requests%rowtype;
begin
  if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
  select * into r from clickbooks_us.manual_journal_requests where id = p_id for update;
  if not found then raise exception 'That journal entry request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'This entry was already %.', r.status; end if;
  if r.created_by <> p_actor then raise exception 'Only the person who wrote it can cancel it (anyone else can reject it).'; end if;
  update clickbooks_us.manual_journal_requests set status = 'cancelled', decided_at = now() where id = p_id;
  insert into clickbooks_us.workflow_events(kind, object_id, actor_id, details) values ('manual_journal_cancelled', p_id, p_actor, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;
$def$;

EXECUTE $def$
create or replace function public.clickbooks_us_mj_list() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(q.row order by q.ord), '[]'::jsonb) from (
    select jsonb_build_object('id', r.id, 'label', 'JE-' || lpad(r.seq::text, 4, '0'), 'date', r.entry_date, 'description', r.description, 'total', r.total_cents / 100.0, 'status', r.status,
             'created_by', r.created_by, 'created_by_name', r.created_by_name, 'created_at', r.created_at, 'decided_by_name', r.decided_by_name, 'decided_at', r.decided_at, 'decide_note', r.decide_note,
             'reverses', (select 'JE-' || lpad(o.seq::text, 4, '0') from clickbooks_us.manual_journal_requests o where o.id = r.reverses_request),
             'reversed_by', (select 'JE-' || lpad(o.seq::text, 4, '0') from clickbooks_us.manual_journal_requests o where o.reverses_request = r.id and o.status in ('pending', 'approved') order by o.seq desc limit 1),
             'lines', (select jsonb_agg(jsonb_build_object('account_id', x->>'account_id', 'code', a.code, 'name', a.name, 'debit', (x->>'debit_cents')::bigint / 100.0, 'credit', (x->>'credit_cents')::bigint / 100.0, 'memo', x->>'memo'))
                         from jsonb_array_elements(r.lines) x left join clickbooks_us.accounts a on a.id = (x->>'account_id')::uuid)) as row,
           row_number() over (order by (r.status = 'pending') desc, r.seq desc) as ord
      from clickbooks_us.manual_journal_requests r order by (r.status = 'pending') desc, r.seq desc limit 200) q
$$;
$def$;

REVOKE ALL ON FUNCTION public.clickbooks_us_mj_accounts() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_mj_create(date, text, jsonb, uuid, text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_mj_decide(uuid, boolean, text, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_mj_cancel(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clickbooks_us_mj_list() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_mj_accounts() TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_mj_create(date, text, jsonb, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_mj_decide(uuid, boolean, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_mj_cancel(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clickbooks_us_mj_list() TO service_role;
RAISE NOTICE 'SL ok — journal entries with a second person''s approval are installed.';
END $sl$;
