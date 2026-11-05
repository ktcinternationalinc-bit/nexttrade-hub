create or replace function public.clickbooks_us_operator_capabilities(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'rules',coalesce((select can_manage_rules from clickbooks_us.operator_grants where auth_user_id=p_actor),false),
  'migration',coalesce((select can_manage_migration from clickbooks_us.operator_grants where auth_user_id=p_actor),false),
  'cutover',coalesce((select can_manage_cutover from clickbooks_us.operator_grants where auth_user_id=p_actor),false)
 )
$$;
create function public.clickbooks_us_operator_grant_set(p_target uuid,p_rules boolean,p_migration boolean,p_cutover boolean,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare r clickbooks_us.operator_grants%rowtype; begin
 if p_target is null or p_actor is null or not exists(select 1 from auth.users where id=p_target and deleted_at is null and (banned_until is null or banned_until<=now()) and coalesce(is_anonymous,false)=false) or not exists(select 1 from auth.users where id=p_actor and deleted_at is null and (banned_until is null or banned_until<=now()) and coalesce(is_anonymous,false)=false) then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_target::text,0));
 insert into clickbooks_us.operator_grants(auth_user_id,can_manage_rules,can_manage_migration,can_manage_cutover,granted_by,granted_at)
 values(p_target,coalesce(p_rules,false),coalesce(p_migration,false),coalesce(p_cutover,false),p_actor,now())
 on conflict(auth_user_id) do update set can_manage_rules=coalesce(p_rules,clickbooks_us.operator_grants.can_manage_rules),can_manage_migration=coalesce(p_migration,clickbooks_us.operator_grants.can_manage_migration),can_manage_cutover=coalesce(p_cutover,clickbooks_us.operator_grants.can_manage_cutover),granted_by=p_actor,granted_at=now()
 returning * into r;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('operator_grant_saved',p_target,p_actor,jsonb_build_object('rules',r.can_manage_rules,'migration',r.can_manage_migration,'cutover',r.can_manage_cutover));
 return jsonb_build_object('authUserId',r.auth_user_id,'rules',r.can_manage_rules,'migration',r.can_manage_migration,'cutover',r.can_manage_cutover);
end $$;
create function public.clickbooks_us_reporting_settings_read() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'code',a.code,'name',a.name,'type',a.account_type,'active',a.is_active,'needsReview',a.needs_review,'bankSensitive',a.is_bank_sensitive,'cashFlowClass',s.cash_flow_class,'taxCategory',s.tax_category,'taxFormLine',s.tax_form_line,'deductibility',s.deductibility,'reviewedAt',s.reviewed_at) order by a.account_type,a.code),'[]'::jsonb)
 from clickbooks_us.accounts a join clickbooks_us.books b on b.id=a.book_id and b.code='KTC_US' left join clickbooks_us.account_reporting_settings s on s.book_id=a.book_id and s.account_id=a.id
$$;
revoke all on function public.clickbooks_us_operator_capabilities(uuid),public.clickbooks_us_operator_grant_set(uuid,boolean,boolean,boolean,uuid),public.clickbooks_us_reporting_settings_read() from public,anon,authenticated;
grant execute on function public.clickbooks_us_operator_capabilities(uuid),public.clickbooks_us_operator_grant_set(uuid,boolean,boolean,boolean,uuid),public.clickbooks_us_reporting_settings_read() to service_role;
