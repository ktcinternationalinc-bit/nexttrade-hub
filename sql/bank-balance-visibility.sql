-- Full-dashboard and bank BALANCE visibility: two independent capabilities,
-- separate from operational transaction/invoice/bill/expense permissions.
-- Apply to the existing Hub database before deploying the matching source.
-- Required server setting: HUB_SUPER_ADMIN_AUTH_USER_IDS = verified Auth UUIDs.
-- Do not populate it from public.users.role or module_permissions. There is no
-- automatic migration of those legacy grants into this protected authority.
begin;

create table if not exists public.financial_visibility_permissions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  can_view_dashboard boolean not null default false,
  can_view_bank_balances boolean not null default false,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.financial_visibility_permission_audit (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid not null,
  target_auth_user_id uuid not null,
  target_profile_id uuid not null,
  previous_can_view_dashboard boolean not null,
  previous_can_view_bank_balances boolean not null,
  can_view_dashboard boolean not null,
  can_view_bank_balances boolean not null,
  created_at timestamptz not null default now()
);
alter table public.financial_visibility_permissions enable row level security;
alter table public.financial_visibility_permission_audit enable row level security;
revoke all on public.financial_visibility_permissions, public.financial_visibility_permission_audit from public, anon, authenticated;
grant select, insert, update on public.financial_visibility_permissions to service_role;
grant select, insert on public.financial_visibility_permission_audit to service_role;

-- Identity mapping is service-only. Confirmed Auth email supports this Hub's
-- older, separately generated profile UUIDs. Count BOTH sides of the mapping
-- before checking active status: ambiguous or duplicate identities fail closed.
create or replace function public.bank_visibility_identity_map()
returns table (profile_id uuid, auth_user_id uuid, name text, email text)
language sql stable security definer set search_path = '' as $$
  with candidates as (
    select p.id as profile_id, a.id as auth_user_id,
      p.name::text as name, a.email::text as email, p.active as profile_active,
      count(*) over (partition by p.id) as profile_matches,
      count(*) over (partition by a.id) as auth_matches
    from public.users p
    join auth.users a on a.id = p.id
      or (a.email_confirmed_at is not null and nullif(btrim(a.email), '') is not null
          and lower(btrim(a.email)) = lower(btrim(p.email)))
    where a.deleted_at is null and (a.banned_until is null or a.banned_until <= now())
      and coalesce((to_jsonb(a)->>'is_anonymous')::boolean, false) = false
  )
  select c.profile_id, c.auth_user_id, c.name, c.email
  from candidates c
  where c.profile_matches = 1 and c.auth_matches = 1 and c.profile_active is true;
$$;

create or replace function public.bank_visibility_profile_for_identity(p_auth_user_id uuid)
returns table (profile_id uuid, auth_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.profile_id, m.auth_user_id
  from public.bank_visibility_identity_map() m where m.auth_user_id = p_auth_user_id limit 2;
$$;

-- Protected-identity checks must also find INACTIVE and BANNED targets, so an
-- ordinary team administrator cannot reactivate or reset a balance grantee.
-- This returns every exact-id/confirmed-email candidate (up to three); callers
-- must reject ambiguity instead of silently selecting a candidate.
create or replace function public.bank_visibility_auth_ids_for_profile(p_profile_id uuid)
returns table (auth_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.id
  from public.users p join auth.users a on a.id = p.id
    or (a.email_confirmed_at is not null and nullif(btrim(a.email), '') is not null
        and lower(btrim(a.email)) = lower(btrim(p.email)))
  where p.id = p_profile_id
  limit 3;
$$;

-- One JSON result avoids PostgREST's row cap silently truncating the grant UI.
create or replace function public.bank_visibility_list_profiles()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(m) order by m.name, m.email), '[]'::jsonb)
  from (select * from public.bank_visibility_identity_map() order by name, email limit 2001) m;
$$;

create or replace function public.bank_visibility_set_grant(
  p_profile_id uuid, p_auth_user_id uuid, p_actor_auth_user_id uuid,
  p_can_view_dashboard boolean default null, p_can_view_bank_balances boolean default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare previous_dashboard boolean; previous_bank boolean; next_dashboard boolean; next_bank boolean;
begin
  if (p_can_view_dashboard is null and p_can_view_bank_balances is null)
     or p_auth_user_id is null or p_actor_auth_user_id is null then return null; end if;
  -- The HTTP route verifies the actor's server-only super-admin allowlist. No
  -- browser role can execute this function, including forged JWT role claims.
  if not exists (select 1 from public.bank_visibility_identity_map() m
                 where m.auth_user_id = p_actor_auth_user_id) then return null; end if;
  if not exists (select 1 from public.bank_visibility_identity_map() m
                 where m.profile_id = p_profile_id and m.auth_user_id = p_auth_user_id) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text, 0));
  select can_view_dashboard, can_view_bank_balances into previous_dashboard, previous_bank from public.financial_visibility_permissions
    where auth_user_id = p_auth_user_id for update;
  next_dashboard := coalesce(p_can_view_dashboard, previous_dashboard, false);
  next_bank := coalesce(p_can_view_bank_balances, previous_bank, false);
  insert into public.financial_visibility_permissions (auth_user_id, can_view_dashboard, can_view_bank_balances, updated_by, updated_at)
    values (p_auth_user_id, next_dashboard, next_bank, p_actor_auth_user_id, now())
    on conflict (auth_user_id) do update
      set can_view_dashboard = excluded.can_view_dashboard, can_view_bank_balances = excluded.can_view_bank_balances,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.financial_visibility_permission_audit
    (actor_auth_user_id, target_auth_user_id, target_profile_id, previous_can_view_dashboard, previous_can_view_bank_balances, can_view_dashboard, can_view_bank_balances)
    values (p_actor_auth_user_id, p_auth_user_id, p_profile_id, coalesce(previous_dashboard, false), coalesce(previous_bank, false), next_dashboard, next_bank);
  return jsonb_build_object('can_view_dashboard', next_dashboard, 'can_view_bank_balances', next_bank);
end;
$$;

revoke all on function public.bank_visibility_identity_map() from public, anon, authenticated;
revoke all on function public.bank_visibility_profile_for_identity(uuid) from public, anon, authenticated;
revoke all on function public.bank_visibility_auth_ids_for_profile(uuid) from public, anon, authenticated;
revoke all on function public.bank_visibility_list_profiles() from public, anon, authenticated;
revoke all on function public.bank_visibility_set_grant(uuid, uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.bank_visibility_identity_map() to service_role;
grant execute on function public.bank_visibility_profile_for_identity(uuid) to service_role;
grant execute on function public.bank_visibility_auth_ids_for_profile(uuid) to service_role;
grant execute on function public.bank_visibility_list_profiles() to service_role;
grant execute on function public.bank_visibility_set_grant(uuid, uuid, uuid, boolean, boolean) to service_role;

-- Known optional metadata columns make the explicit browser selectors stable
-- on earlier Hub migrations. No provider balance/credential is copied here.
alter table if exists public.bank_connections
  add column if not exists wave_business_id text,
  add column if not exists last_sync_status text,
  add column if not exists last_sync_error text,
  add column if not exists initial_backfill_start_date date,
  add column if not exists last_successful_posted_date date,
  add column if not exists last_successful_plaid_sync_at timestamptz;
alter table if exists public.plaid_accounts
  add column if not exists wave_business_id text,
  add column if not exists assigned_by uuid,
  add column if not exists assigned_at timestamptz,
  add column if not exists assignment_source text;

-- Revoke table AND pre-existing column privileges. RLS alone cannot hide a
-- balance column while allowing the same transaction reviewer to see metadata.
-- Browser writes to provider accounts/connections were already routed through
-- server APIs. Matching, classifications, invoices/bills and their tables are
-- deliberately unaffected. The service role retains ingestion/assignment.
do $$
declare table_name text; columns_sql text; policy_name text;
begin
  foreach table_name in array array['financial_visibility_permissions', 'financial_visibility_permission_audit', 'bank_connections', 'plaid_accounts', 'backups'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
      select string_agg(quote_ident(a.attname), ',') into columns_sql
        from pg_attribute a where a.attrelid = to_regclass('public.' || table_name) and a.attnum > 0 and not a.attisdropped;
      if columns_sql is not null then
        execute format('revoke all (%s) on table public.%I from public, anon, authenticated', columns_sql, table_name);
      end if;
      for policy_name in select pol.polname from pg_policy pol where pol.polrelid = to_regclass('public.' || table_name) loop
        execute format('drop policy %I on public.%I', policy_name, table_name);
      end loop;
      if table_name in ('bank_connections', 'plaid_accounts') then
        execute format('create policy bank_metadata_select on public.%I for select to authenticated using (true)', table_name);
        execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
      elsif table_name = 'backups' then
        execute 'grant select, insert, update, delete on public.backups to service_role';
      end if;
    end if;
  end loop;
  if to_regclass('public.bank_connections') is not null then
    grant select (id, institution_id, institution_name, status, last_synced, created_at,
      wave_business_id, last_sync_status, last_sync_error, initial_backfill_start_date,
      last_successful_posted_date, last_successful_plaid_sync_at) on public.bank_connections to authenticated;
  end if;
  if to_regclass('public.plaid_accounts') is not null then
    grant select (id, connection_id, business_id, plaid_account_id, name, official_name,
      mask, type, subtype, iso_currency, is_read_only, updated_at,
      wave_business_id, assigned_by, assigned_at, assignment_source) on public.plaid_accounts to authenticated;
  end if;
end;
$$;

-- Older scheduled Plaid pulls logged raw accounts, including balances. Remove
-- only provider credentials and account-balance fields in those log payloads;
-- transaction/payment/invoice amounts and operational log details are retained.
create or replace function pg_temp.bank_scrub_provider_log(p_value jsonb, in_accounts boolean default false)
returns jsonb language plpgsql as $$
declare result jsonb; pair record; child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    result := '{}'::jsonb;
    for pair in select entry.key, entry.value as val from jsonb_each(p_value) as entry loop
      if lower(pair.key) in ('access_token', 'public_token', 'link_token', 'refresh_token', 'plaid_access_token', 'secret', 'client_secret') then continue; end if;
      if in_accounts and lower(pair.key) in ('balances', 'balance', 'current_balance', 'available_balance', 'currentbalancecents', 'availablebalancecents') then continue; end if;
      result := result || jsonb_build_object(pair.key, pg_temp.bank_scrub_provider_log(pair.val, in_accounts or lower(pair.key) = 'accounts'));
    end loop;
    return result;
  elsif jsonb_typeof(p_value) = 'array' then
    result := '[]'::jsonb;
    for child in select * from jsonb_array_elements(p_value) loop
      result := result || jsonb_build_array(pg_temp.bank_scrub_provider_log(child, in_accounts));
    end loop;
    return result;
  end if;
  return p_value;
end;
$$;
do $$
begin
  if to_regclass('public.wave_sync_log') is not null then
    update public.wave_sync_log
      set response_payload = pg_temp.bank_scrub_provider_log(response_payload)
      where entity_type = 'plaid_transactions' and response_payload is not null
        and response_payload is distinct from pg_temp.bank_scrub_provider_log(response_payload);
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
