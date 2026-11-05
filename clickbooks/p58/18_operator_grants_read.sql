create function public.clickbooks_us_operator_grants_read() returns table(auth_user_id uuid,can_manage_rules boolean,can_manage_migration boolean,can_manage_cutover boolean,granted_by uuid,granted_at timestamptz)
language sql stable security definer set search_path='' as $$
 select g.auth_user_id,g.can_manage_rules,g.can_manage_migration,g.can_manage_cutover,g.granted_by,g.granted_at
 from clickbooks_us.operator_grants g order by g.auth_user_id
$$;
revoke all on function public.clickbooks_us_operator_grants_read() from public,anon,authenticated;
grant execute on function public.clickbooks_us_operator_grants_read() to service_role;
