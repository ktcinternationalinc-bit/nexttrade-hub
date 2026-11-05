-- Ledgerly -> KTC automatic read-only snapshot integration.
-- Additive: no existing accounting, Wave, bank, inventory or user records change.
-- Run once on the EXISTING hub's Supabase project before deploying this feature.
begin;

create table if not exists public.ledgerly_sync_state (
  id text primary key check (id = 'primary'),
  snapshot jsonb,
  sync_status text not null default 'waiting' check (sync_status in ('waiting', 'running', 'ready', 'error')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  check ((lease_token is null) = (lease_until is null))
);
alter table public.ledgerly_sync_state enable row level security;
revoke all on public.ledgerly_sync_state from public, anon, authenticated;
grant select, insert, update on public.ledgerly_sync_state to service_role;

-- No browser RLS policies are created. Only service-role routes may access the
-- snapshot, and the read route verifies financial authorization separately.
create or replace function public.ledgerly_claim_sync(p_run_id uuid)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare affected integer;
begin
  if p_run_id is null then return false; end if;
  insert into public.ledgerly_sync_state (id) values ('primary') on conflict (id) do nothing;
  update public.ledgerly_sync_state
    set lease_token = p_run_id, lease_until = now() + interval '2 minutes',
        sync_status = 'running', last_attempt_at = now(), updated_at = now()
    where id = 'primary' and (lease_until is null or lease_until < now());
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.ledgerly_commit_sync(p_run_id uuid, p_snapshot jsonb)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare affected integer;
begin
  if p_run_id is null or p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or p_snapshot->>'schemaVersion' is distinct from '1' or jsonb_typeof(p_snapshot->'datasets') is distinct from 'object'
     or coalesce(p_snapshot->>'configId' !~ '^[a-f0-9]{64}$', true)
     or coalesce(p_snapshot->>'revision' !~ '^[0-9]+$', true)
     or (p_snapshot->>'revision')::numeric > 9007199254740991 then
    raise exception 'Invalid Ledgerly snapshot';
  end if;
  update public.ledgerly_sync_state
    set snapshot = p_snapshot, sync_status = 'ready', last_success_at = now(),
        last_error_code = null, last_error = null, lease_token = null, lease_until = null, updated_at = now()
    where id = 'primary' and lease_token = p_run_id and lease_until >= now()
      and (snapshot is null or snapshot->>'configId' is distinct from p_snapshot->>'configId'
        or (snapshot->>'revision')::numeric <= (p_snapshot->>'revision')::numeric);
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.ledgerly_fail_sync(p_run_id uuid, p_error_code text, p_error text)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare affected integer;
begin
  update public.ledgerly_sync_state
    set sync_status = 'error', last_error_code = left(p_error_code, 80), last_error = left(p_error, 300),
        lease_token = null, lease_until = null, updated_at = now()
    where id = 'primary' and lease_token = p_run_id;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

-- The caller supplies these values only after Supabase Auth validates the JWT.
-- The function is service-role-only; browser callers cannot impersonate an email.
create or replace function public.ledgerly_profile_for_identity(p_auth_user_id uuid, p_verified_email text)
returns table (id uuid, role text, active boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select u.id, u.role::text, u.active
  from public.users u
  where u.id = p_auth_user_id
     or (p_verified_email is not null and length(p_verified_email) between 3 and 254
         and lower(btrim(u.email)) = lower(btrim(p_verified_email)))
  limit 3;
$$;

revoke all on function public.ledgerly_claim_sync(uuid) from public, anon, authenticated;
revoke all on function public.ledgerly_commit_sync(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ledgerly_fail_sync(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ledgerly_profile_for_identity(uuid, text) from public, anon, authenticated;
grant execute on function public.ledgerly_claim_sync(uuid) to service_role;
grant execute on function public.ledgerly_commit_sync(uuid, jsonb) to service_role;
grant execute on function public.ledgerly_fail_sync(uuid, text, text) to service_role;
grant execute on function public.ledgerly_profile_for_identity(uuid, text) to service_role;

commit;
