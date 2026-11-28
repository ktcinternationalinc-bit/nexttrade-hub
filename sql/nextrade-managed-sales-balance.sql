create table if not exists public.nextrade_managed_sales_balances (
  opening_id uuid primary key references public.party_opening_balances(id),
  source_period daterange not null,
  source_signature text not null,
  source_rows jsonb not null,
  request_id text not null unique,
  check (not isempty(source_period)),
  exclude using gist (source_period with &&)
);
alter table public.nextrade_managed_sales_balances enable row level security;
revoke all on public.nextrade_managed_sales_balances from public, anon, authenticated, service_role;
grant select, insert on public.nextrade_managed_sales_balances to service_role;

create or replace function public.hub_nextrade_managed_sales_preview(p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_sales numeric;
  v_remitted numeric;
  v_reversed numeric;
  v_rows jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to > (now() at time zone 'America/New_York')::date then
    raise exception 'HUB_GUARD: Choose a valid date range ending today or earlier.';
  end if;
  select coalesce(sum(round(t.amount_abs, 2)) filter (where t.company_category = 'sales' and t.direction = 'in'), 0),
    coalesce(sum(round(t.amount_abs, 2)) filter (where t.company_category = 'sales_ktc_managed_income'), 0),
    coalesce(sum(round(t.amount_abs, 2)) filter (where t.company_category = 'sales' and t.direction = 'out'), 0),
    coalesce(jsonb_agg(jsonb_build_array(t.id, t.date, t.direction, t.company_category, round(t.amount_abs, 2)) order by t.date, t.id), '[]'::jsonb)
  into v_sales, v_remitted, v_reversed, v_rows
  from public.bank_transactions t
  where t.wave_business_id = 'NEXTRADE_BOOKS'
    and t.date between p_from and p_to and coalesce(upper(t.iso_currency), 'USD') = 'USD'
    and t.pending is not true and t.review_status is distinct from 'duplicate' and t.transfer_group_id is null
    and t.amount_abs > 0 and t.direction in ('in', 'out')
    and (t.company_category = 'sales' or (t.company_category = 'sales_ktc_managed_income' and t.direction = 'out'));
  return jsonb_build_object('sales', v_sales, 'remitted', v_remitted, 'reversed', v_reversed,
    'net', v_sales - v_remitted - v_reversed, 'source_rows', v_rows, 'signature', md5(v_rows::text),
    'already_used', exists (select from public.nextrade_managed_sales_balances b where b.source_period && daterange(p_from, p_to, '[]')));
end
$$;

create or replace function public.hub_nextrade_managed_sales_add(p jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_from date := (p->>'from')::date;
  v_to date := (p->>'to')::date;
  v_request text := p->>'request_id';
  v_signature text := p->>'signature';
  v_held numeric := (p->>'held')::numeric;
  v_actor uuid := (p->>'actor')::uuid;
  v_reason text := trim(coalesce(p->>'reason', ''));
  v_quote jsonb;
  v_result jsonb;
  v_prior record;
  v_party text := 'NextTrade Industries';
begin
  if v_actor is null or v_request is null or length(v_request) < 8 or v_signature is null or
    v_held is null or v_held <= 0 or v_held <> round(v_held, 2) or length(v_reason) < 10 or
    coalesce(jsonb_typeof(p->'visible_to_staff'), '') <> 'boolean' then
    raise exception 'HUB_GUARD: Confirm the amount still held, its reference, and staff visibility.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hub-party:' || v_party, 0));
  select s.opening_id, s.source_period, s.source_signature, b.amount, b.created_by, b.visible_to_staff
    into v_prior from public.nextrade_managed_sales_balances s join public.party_opening_balances b on b.id = s.opening_id
    where s.request_id = v_request;
  if found then
    if v_prior.source_period = daterange(v_from, v_to, '[]') and v_prior.source_signature = v_signature and
      v_prior.amount = v_held and v_prior.created_by = v_actor and v_prior.visible_to_staff = (p->>'visible_to_staff')::boolean then
      return jsonb_build_object('ok', true, 'id', v_prior.opening_id, 'repeat', true);
    end if;
    raise exception 'HUB_GUARD: This save was already used. Review the balance again.';
  end if;
  v_quote := public.hub_nextrade_managed_sales_preview(v_from, v_to);
  if v_quote->>'signature' is distinct from v_signature then
    raise exception 'HUB_GUARD: The source transactions changed. Preview the balance again.';
  end if;
  if (v_quote->>'already_used')::boolean then
    raise exception 'HUB_GUARD: A managed-sales balance already uses dates in this range.';
  end if;
  if v_held > (v_quote->>'net')::numeric then
    raise exception 'HUB_GUARD: The amount still held exceeds the net sales proceeds for these dates.';
  end if;
  v_result := public.hub_party_opening_add(jsonb_build_object(
    'party', v_party, 'amount', v_held, 'as_of', v_to, 'actor', v_actor, 'request_id', 'managed-sales:' || v_request,
    'visible_to_staff', p->'visible_to_staff',
    'reason', 'NextTrade-managed sales ' || v_from || ' to ' || v_to || '. ' || left(v_reason, 375)
  ));
  insert into public.nextrade_managed_sales_balances(opening_id, source_period, source_signature, source_rows, request_id)
    values ((v_result->>'id')::uuid, daterange(v_from, v_to, '[]'), v_signature, v_quote->'source_rows', v_request);
  return jsonb_build_object('ok', true, 'id', v_result->'id');
end
$$;

revoke all on function public.hub_nextrade_managed_sales_preview(date, date) from public, anon, authenticated, service_role;
revoke all on function public.hub_nextrade_managed_sales_add(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hub_nextrade_managed_sales_preview(date, date) to service_role;
grant execute on function public.hub_nextrade_managed_sales_add(jsonb) to service_role;
