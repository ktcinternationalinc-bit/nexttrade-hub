-- Only the verified server can call these facades. Browser JWT roles are denied.
create function public.clickbooks_us_operator_capabilities(p_actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('rules',coalesce((select can_manage_rules from clickbooks_us.operator_grants where auth_user_id=p_actor),false),'migration',coalesce((select can_manage_migration from clickbooks_us.operator_grants where auth_user_id=p_actor),false))
$$;
create function public.clickbooks_us_workbench_read(p_area text,p_run uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b clickbooks_us.books%rowtype; rs jsonb; ps jsonb; ac jsonb; detail jsonb; source jsonb;
begin
 select * into strict b from clickbooks_us.books where code='KTC_US';
 if p_area='migration' then
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into rs from(select id,cutoff,strategy,state,revision,snapshot_hash,created_at,approved_at,committed_at,clickbooks_us.migration_report(snapshot) report from clickbooks_us.migration_runs where book_id=b.id order by created_at desc,id desc limit 50)x;
 if p_run is not null then select jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'cutoff',r.cutoff,'strategy',r.strategy,'snapshot',r.snapshot,'snapshotHash',r.snapshot_hash,'plans',r.plans,'expectedBalances',r.expected_balances,'openingSubledger',r.opening_subledger,'evidence',r.evidence,'report',clickbooks_us.migration_report(r.snapshot),'sourceChanged',md5(clickbooks_us.source_snapshot(r.cutoff)::text)<>r.snapshot_hash) into detail from clickbooks_us.migration_runs r where r.book_id=b.id and r.id=p_run;
 if detail is null then raise exception 'CB_RUN_NOT_FOUND'; end if; end if;
 select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',account_type,'needsReview',needs_review,'bankSensitive',is_bank_sensitive,'active',is_active) order by code) into ac from clickbooks_us.accounts where book_id=b.id;
 return jsonb_build_object('scope','KTC_US','area','migration','runs',rs,'runCount',(select count(*) from clickbooks_us.migration_runs where book_id=b.id),'selected',detail,'accounts',ac,'postingEnabled',b.posting_enabled,'executionEnabled',(select migration_execution_enabled from clickbooks_us.workflow_settings where singleton),'historyReady',b.historical_data_ready,'openingCutoff',b.opening_cutoff);
 elsif p_area='rules' and p_run is null then
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'name',name,'priority',priority,'enabled',enabled,'conditions',conditions,'action',action) order by priority,id),'[]') into rs from clickbooks_us.rules where book_id=b.id;
 source:=clickbooks_us.source_snapshot(current_date)->'bank';
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'sourceId',q.source_id,'ruleId',q.rule_id,'revision',q.rule_revision,'outcome',q.outcome,'state',q.state,'reason',q.reason,'description',t->>'name','date',t->>'date','amount',t->>'amount','direction',t->>'direction','stale',t is null or md5(t::text)<>q.source_hash or r.revision<>q.rule_revision or not r.enabled) order by q.created_at desc,q.id),'[]') into ps
 from(select * from clickbooks_us.rule_proposals where book_id=b.id and state in ('proposed','approved') order by created_at desc,id limit 200)q
 join clickbooks_us.rules r on r.id=q.rule_id left join jsonb_array_elements(source)t on t->>'id'=q.source_id::text;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'needsReview',needs_review,'type',account_type) order by name),'[]') into ac from clickbooks_us.accounts where book_id=b.id and is_active and not is_bank_sensitive and code not in ('1100','2000','2400','3000');
 return jsonb_build_object('scope','KTC_US','area','rules','rules',rs,'proposals',ps,'proposalCount',(select count(*) from clickbooks_us.rule_proposals where book_id=b.id and state in ('proposed','approved')),'accounts',ac,'postsToLedger',false);
 end if;
 raise exception 'CB_INVALID_WORKBENCH_AREA';
end $$;
create function public.clickbooks_us_workbench_action(p_action text,p_payload jsonb,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; v jsonb; begin
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor and deleted_at is null and (banned_until is null or banned_until<now()) and coalesce(is_anonymous,false)=false) then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1048576 then raise exception 'CB_INVALID_REQUEST'; end if;
 case p_action
 when 'snapshot' then rid:=clickbooks_us.create_migration_run((p_payload->>'requestId')::uuid,(p_payload->>'cutoff')::date,p_payload->>'strategy',p_actor); return jsonb_build_object('runId',rid,'posted',false);
 when 'save_plan' then perform clickbooks_us.set_migration_plan((p_payload->>'runId')::uuid,(p_payload->>'revision')::int,p_payload->'plans',p_payload->'expectedBalances',p_payload->'openingSubledger',p_payload->>'evidence',p_actor); return jsonb_build_object('saved',true,'posted',false);
 when 'validate_plan' then return clickbooks_us.validate_migration((p_payload->>'runId')::uuid);
 when 'save_rule' then rid:=clickbooks_us.save_rule((p_payload->>'id')::uuid,(p_payload->>'revision')::int,p_payload->'definition',p_actor); return jsonb_build_object('ruleId',rid,'posted',false);
 when 'preview_rule' then return clickbooks_us.preview_rule(p_payload->'definition');
 when 'stage_rules' then return clickbooks_us.stage_rule_proposals(p_actor);
 when 'decide_proposal' then perform clickbooks_us.decide_proposal((p_payload->>'id')::uuid,(p_payload->>'accept')::boolean,p_payload->>'reason',p_actor); return jsonb_build_object('saved',true,'posted',false);
 else raise exception 'CB_ACTION_NOT_ALLOWED'; end case;
end $$;
create function public.clickbooks_us_rules_stage_job() returns jsonb language sql security definer set search_path='' as $$ select clickbooks_us.stage_rule_proposals(null) $$;
revoke all on function public.clickbooks_us_operator_capabilities(uuid),public.clickbooks_us_workbench_read(text,uuid),public.clickbooks_us_workbench_action(text,jsonb,uuid),public.clickbooks_us_rules_stage_job() from public,anon,authenticated;
grant execute on function public.clickbooks_us_operator_capabilities(uuid),public.clickbooks_us_workbench_read(text,uuid),public.clickbooks_us_workbench_action(text,jsonb,uuid),public.clickbooks_us_rules_stage_job() to service_role;
revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
