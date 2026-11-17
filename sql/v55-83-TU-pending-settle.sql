-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TU — PENDING BANK LINES SETTLED IN ONE STEP (Max, Nov 17 2026; Codex QA 17 Nov P1 x2)
-- When a pending bank line has POSTED, this one function, in ONE transaction:
--   1. locks both lines;
--   2. files the pending copy away through bank_duplicate_remove (every accounting guard: invoice match, payments, transfer,
--      split, wire, closed month…). If that refuses, NOTHING changes — not the pending line, not the posted line;
--   3. only then copies the person's work (category, verified mark, reviewed status, paid-through company) onto the posted line —
--      and only when the two are the same money: same amount, direction, currency and company, and the posted line has no
--      category yet or the same one. Otherwise nothing is copied (approval never moves across changed details).
-- Codex recheck 17 Nov: (a) the POSTED line's own date is checked against the closed books too — a closed posted line → refused,
-- both lines unchanged; (b) every settlement is RECORDED (hub_pending_settlements: pending → posted) and a repeat is accepted
-- only for the IDENTICAL pair (same pending, same posted, or both without a posted line) — never from the duplicates log alone.
-- Needs sql/v55-83-SO-duplicates.sql first. Adds one table and one function. Nothing existing is changed or deleted.
-- Safe to run more than once.

create table if not exists public.hub_pending_settlements (
  pending_id uuid primary key,          -- the pending line that was filed away (one settlement per pending line, ever)
  posted_id uuid,                       -- the posted line it became (null = filed with no posted line)
  same_money boolean not null default false,
  carried jsonb not null default '[]'::jsonb,
  reason text,
  settled_at timestamptz not null default now()
);
alter table public.hub_pending_settlements enable row level security; -- no policies: service role only
revoke all on public.hub_pending_settlements from public, anon, authenticated;
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.hub_settle_pending(p_pending uuid, p_posted uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pj jsonb; qj jsonb; res jsonb;
  same_money boolean; may_carry boolean;
  col text; carried text[] := '{}'; lock_through date; q_date date;
  cols text[] := array['classification','category_source','category_verified','category_verified_by','category_verified_at','third_party_payer'];
begin
  if p_pending is null then return jsonb_build_object('ok', false, 'why', 'No pending line was given.'); end if;
  select to_jsonb(t) into pj from public.bank_transactions t where t.id = p_pending for update;
  if pj is null then
    -- a repeat is fine ONLY for the identical recorded pair; anything else is for a person
    if exists (select 1 from public.hub_pending_settlements s where s.pending_id = p_pending and s.posted_id is not distinct from p_posted) then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    return jsonb_build_object('ok', false, 'why', 'The pending line is no longer on the Hub and was not settled into this posted line by this step.');
  end if;
  if coalesce((pj->>'pending')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'why', 'That line is no longer marked pending — a person or another sync changed it.');
  end if;
  if p_posted is not null then
    select to_jsonb(t) into qj from public.bank_transactions t where t.id = p_posted for update;
    if qj is null then return jsonb_build_object('ok', false, 'why', 'The posted line was not found.'); end if;
    -- the posted line's own date against the closed books (posted date, else date) — before anything changes
    if to_regclass('clickbooks_us.books') is not null then
      execute 'select locked_through from clickbooks_us.books where code = ''KTC_US''' into lock_through;
      q_date := coalesce(nullif(qj->>'posted_date','')::date, nullif(qj->>'date','')::date);
      if lock_through is not null and q_date is not null and q_date <= lock_through then
        return jsonb_build_object('ok', false, 'why', 'The posted line is dated ' || q_date || ', inside a closed month (books are closed through ' || lock_through || '). Reopen the month first (Accounting → Month-end).', 'blocked_by', 'closed month');
      end if;
    end if;
  end if;

  same_money := qj is not null
    and round(abs(coalesce((pj->>'amount_abs')::numeric, abs((pj->>'amount')::numeric), 0)) * 100)
      = round(abs(coalesce((qj->>'amount_abs')::numeric, abs((qj->>'amount')::numeric), 0)) * 100)
    and coalesce(pj->>'direction','') = coalesce(qj->>'direction','')
    and coalesce(nullif(pj->>'iso_currency',''),'USD') = coalesce(nullif(qj->>'iso_currency',''),'USD')
    and coalesce(pj->>'wave_business_id','') = coalesce(qj->>'wave_business_id','');

  -- 1. file the pending copy away with every guard; refused → nothing at all changes
  res := public.bank_duplicate_remove(p_pending, case when same_money then p_posted else null end, null, p_reason);
  if coalesce((res->>'ok')::boolean, false) is not true then
    raise exception 'HUB_SETTLE_REFUSED:%', coalesce(res->>'why', 'refused');
  end if;

  -- 2. the person's work moves across only when it is the same money and no different category is already on the posted line
  may_carry := same_money and (nullif(qj->>'classification','') is null or qj->>'classification' = pj->>'classification');
  if may_carry then
    foreach col in array cols loop
      if exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'bank_transactions' and c.column_name = col)
         and nullif(pj->>col, '') is not null and coalesce(pj->>col, '') <> 'false'
         and (nullif(qj->>col, '') is null or qj->>col = 'false') then
        execute format('update public.bank_transactions set %I = (jsonb_populate_record(null::public.bank_transactions, $1)).%I where id = $2', col, col)
          using jsonb_build_object(col, pj->col), p_posted;
        carried := carried || col;
      end if;
    end loop;
    if pj->>'review_status' = 'reviewed' and coalesce(qj->>'review_status','') in ('', 'unreviewed', 'new') then
      update public.bank_transactions set review_status = 'reviewed' where id = p_posted;
      carried := carried || 'review_status'::text;
    end if;
  end if;
  insert into public.hub_pending_settlements (pending_id, posted_id, same_money, carried, reason)
    values (p_pending, p_posted, coalesce(same_money, false), to_jsonb(carried), left(coalesce(p_reason, ''), 500))
    -- a pending line a person RESTORED and that is settled again: the record follows the latest settlement
    on conflict (pending_id) do update set posted_id = excluded.posted_id, same_money = excluded.same_money, carried = excluded.carried,
      reason = excluded.reason, settled_at = now();
  return jsonb_build_object('ok', true, 'same_money', same_money, 'carried', to_jsonb(carried));
exception when others then
  if sqlerrm like 'HUB_SETTLE_REFUSED:%' then
    return jsonb_build_object('ok', false, 'why', substr(sqlerrm, 20));
  end if;
  raise;
end $$;
revoke all on function public.hub_settle_pending(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.hub_settle_pending(uuid, uuid, text) to service_role;

-- proof: one row, true
select exists (select 1 from pg_proc where proname = 'hub_settle_pending') as settle_pending_installed;
