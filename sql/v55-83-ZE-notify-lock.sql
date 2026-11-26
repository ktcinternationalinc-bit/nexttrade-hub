-- v55.83-ZM — close public.notifications to the browser (Max 26 Nov: close the open notify hole; Codex 25 Nov).
-- WHAT IT DOES: removes the policy allow_all_notifications (anyone, even with no sign-in, could read, change or delete
-- anyone's notices) and takes every right on the table away from the browser roles anon and authenticated.
-- Only the Hub's server (service_role) keeps access. Nothing is deleted: the 2 rows (and any new ones) stay.
-- RUN IT ONLY AFTER build ZM is LIVE (the bell then reads through /api/notifications, the server).
-- Run it before ZM is live and the old bell stops loading until ZM is out; nothing breaks for good.
-- The whole thing is one transaction: if any check fails, nothing changes.

begin;

-- 1) SAFETY CHECKS: stops with a plain message if the table is not what this script expects.
do $$
declare v_cols text; v_pol int;
begin
  if to_regclass('public.notifications') is null then
    raise exception 'STOP: public.notifications does not exist — nothing to lock.';
  end if;
  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'notifications';
  if v_cols is distinct from 'body,created_at,id,read,title,type,user_id' then
    raise exception 'STOP: public.notifications has columns % — expected body,created_at,id,read,title,type,user_id. Ask Claude before running.', v_cols;
  end if;
  select count(*) into v_pol from pg_policies where schemaname = 'public' and tablename = 'notifications'
    and policyname <> 'allow_all_notifications';
  if v_pol > 0 then
    raise exception 'STOP: public.notifications has % other polic(ies) besides allow_all_notifications. Ask Claude before running.', v_pol;
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.notifications'::regclass and not tgisinternal) then
    raise exception 'STOP: public.notifications has a trigger. Ask Claude before running.';
  end if;
end $$;

-- 2) THE LOCK
alter table public.notifications enable row level security;          -- already on; kept so the end state is certain
drop policy if exists allow_all_notifications on public.notifications;  -- the open door
revoke all on table public.notifications from anon;                     -- no sign-in: no access at all
revoke all on table public.notifications from authenticated;            -- the browser, signed in: no access (the bell uses the server)
grant select, insert, update on table public.notifications to service_role;  -- the Hub server keeps reading, writing, marking read

-- 3) PROOF (shown after it runs): expect rls = true, policies = 0, browser_rights = 0, server_rights = 3+, rows unchanged.
select (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notifications') as policies,
       (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'notifications'
          and grantee in ('anon', 'authenticated')) as browser_rights,
       (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'notifications'
          and grantee = 'service_role' and privilege_type in ('SELECT', 'INSERT', 'UPDATE')) as server_rights,
       (select count(*) from public.notifications) as rows_kept;

commit;

-- ============================================================================================
-- ROLLBACK (only if Max asks to undo it): puts back exactly what was there on 26 Nov 2026 —
-- the allow_all policy for everyone and full rights for anon and authenticated. It re-opens the hole.
-- ============================================================================================
-- begin;
-- create policy allow_all_notifications on public.notifications for all to public using (true);
-- grant select, insert, update, delete, truncate, references, trigger on table public.notifications to anon;
-- grant select, insert, update, delete, truncate, references, trigger on table public.notifications to authenticated;
-- commit;
