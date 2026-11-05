-- Rules produce reviewed classifications in ClickBooks, never bank payments or tax filings.
create function clickbooks_us.cents(p text,p_signed boolean default false) returns bigint
language plpgsql immutable security invoker set search_path='' as $$ begin
 if p is null or p !~ (case when p_signed then '^-?[0-9]{1,15}$' else '^[0-9]{1,15}$' end) then raise exception 'CB_INTEGER_CENTS_REQUIRED'; end if;
 return p::bigint;
end $$;
create function clickbooks_us.validate_rule(d jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare c jsonb; a jsonb; x jsonb; b uuid; total integer:=0; seen uuid[]:=array[]::uuid[]; aid uuid;
begin
 if d is null or jsonb_typeof(d)<>'object' or exists(select 1 from jsonb_object_keys(d) k where k not in ('name','priority','enabled','conditions','action')) then raise exception 'CB_INVALID_RULE'; end if;
 if jsonb_typeof(d->'name') is distinct from 'string' or length(trim(d->>'name')) not between 1 and 120 or coalesce(d->>'priority','') !~ '^[0-9]{1,5}$' or (d->>'priority')::int not between 1 and 10000 or jsonb_typeof(d->'enabled') is distinct from 'boolean' then raise exception 'CB_INVALID_RULE'; end if;
 c:=d->'conditions'; a:=d->'action'; select id into strict b from clickbooks_us.books where code='KTC_US';
 if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object' then raise exception 'CB_INVALID_RULE'; end if;
 if exists(select 1 from jsonb_object_keys(c) k where k not in ('direction','text','merchant','bankAccountId','minCents','maxCents','fromDate','toDate'))
 or c->>'direction' is null or c->>'direction' not in ('in','out') then raise exception 'CB_INVALID_CONDITIONS'; end if;
 if not(c ? 'text' or c ? 'merchant' or c ? 'bankAccountId' or c ? 'minCents' or c ? 'maxCents') then raise exception 'CB_SPECIFIC_CONDITION_REQUIRED'; end if;
 if exists(select 1 from jsonb_each(c) e where e.key in ('text','merchant','bankAccountId') and (jsonb_typeof(e.value)<>'string' or length(trim(e.value#>>'{}')) not between 1 and 200)) then raise exception 'CB_INVALID_TEXT_CONDITION'; end if;
 if c ? 'minCents' then perform clickbooks_us.cents(c->>'minCents'); end if;
 if c ? 'maxCents' then perform clickbooks_us.cents(c->>'maxCents'); end if;
 if c ? 'minCents' and c ? 'maxCents' and (c->>'minCents')::bigint>(c->>'maxCents')::bigint then raise exception 'CB_INVALID_AMOUNT_RANGE'; end if;
 if c ? 'fromDate' and (coalesce(c->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((c->>'fromDate')::date)) then raise exception 'CB_INVALID_DATE'; end if;
 if c ? 'toDate' and (coalesce(c->>'toDate','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((c->>'toDate')::date)) then raise exception 'CB_INVALID_DATE'; end if;
 if c ? 'fromDate' and c ? 'toDate' and (c->>'fromDate')::date>(c->>'toDate')::date then raise exception 'CB_INVALID_DATE_RANGE'; end if;
 if exists(select 1 from jsonb_object_keys(a) k where k not in ('kind','splits','taxTag')) or coalesce(a->>'kind','') not in ('categorize','transfer_review','invoice_match_review') then raise exception 'CB_INVALID_ACTION'; end if;
 if a ? 'taxTag' and (jsonb_typeof(a->'taxTag')<>'string' or length(a->>'taxTag') not between 1 and 80) then raise exception 'CB_INVALID_TAX_TAG'; end if;
 if a->>'kind'<>'categorize' then
  if a ? 'splits' then raise exception 'CB_REVIEW_ACTION_HAS_NO_POSTING'; end if;
  return;
 end if;
 if jsonb_typeof(a->'splits') is distinct from 'array' or jsonb_array_length(a->'splits') not between 1 and 20 then raise exception 'CB_INVALID_SPLITS'; end if;
 for x in select value from jsonb_array_elements(a->'splits') loop
  if jsonb_typeof(x)<>'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('accountId','basisPoints')) or coalesce(x->>'basisPoints','') !~ '^[0-9]{1,5}$' or (x->>'basisPoints')::int not between 1 and 10000 then raise exception 'CB_INVALID_SPLITS'; end if;
  aid:=(x->>'accountId')::uuid;
  if aid=any(seen) or not exists(select 1 from clickbooks_us.accounts where book_id=b and id=aid and is_active and not is_bank_sensitive and code not in ('1100','2000','2400','3000')) then raise exception 'CB_RULE_TARGET_NOT_ALLOWED'; end if;
  seen:=array_append(seen,aid); total:=total+(x->>'basisPoints')::int;
 end loop;
 if total<>10000 then raise exception 'CB_SPLITS_MUST_TOTAL_10000'; end if;
end $$;
create function clickbooks_us.rule_matches(c jsonb,t jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare n numeric;
begin
 if t->>'currency' is distinct from 'USD' or t->>'pending' is distinct from 'false' or t->>'date' is null or t->>'direction' is distinct from c->>'direction' then return false; end if;
 if coalesce(t->>'amount','') !~ '^[0-9]+(\.[0-9]+)?$' then return false; end if;
 n:=(t->>'amount')::numeric*100;
 if n<=0 or n<>trunc(n) or n>999999999999999 then return false; end if;
 if c ? 'text' and strpos(lower(coalesce(t->>'name','')),lower(c->>'text'))=0 then return false; end if;
 if c ? 'merchant' and strpos(lower(coalesce(t->>'merchant','')),lower(c->>'merchant'))=0 then return false; end if;
 if c ? 'bankAccountId' and t->>'accountId' is distinct from c->>'bankAccountId' then return false; end if;
 if c ? 'minCents' and n<(c->>'minCents')::bigint then return false; end if;
 if c ? 'maxCents' and n>(c->>'maxCents')::bigint then return false; end if;
 if c ? 'fromDate' and (t->>'date')::date<(c->>'fromDate')::date then return false; end if;
 if c ? 'toDate' and (t->>'date')::date>(c->>'toDate')::date then return false; end if;
 return true;
end $$;
create function clickbooks_us.rule_eligible(t jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(t->>'currency'='USD' and t->>'pending'='false' and t->>'review'='unreviewed'
 and nullif(t->>'classification','') is null and nullif(t->>'linkedType','') is null and t->>'linkedId' is null and t->>'matchedInvoiceId' is null
 and t->>'hasPayment'='false' and t->>'hasSplits'='false',false)
$$;
create function clickbooks_us.rule_outcome(a jsonb,t jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare x jsonb; n bigint; used bigint:=0; part bigint; i int:=0; ls jsonb:='[]'; len int;
begin
 if a->>'kind'='categorize' then
 n:=((t->>'amount')::numeric*100)::bigint; len:=jsonb_array_length(a->'splits');
 for x in select value from jsonb_array_elements(a->'splits') loop
 i:=i+1; part:=case when i=len then n-used else trunc(n::numeric*(x->>'basisPoints')::int/10000)::bigint end;
 used:=used+part;
 ls:=ls||jsonb_build_array(jsonb_build_object('accountId',x->>'accountId','amountCents',part::text));
 end loop;
 end if;
 return jsonb_build_object('kind',a->>'kind','allocations',ls,'taxTag',coalesce(a->>'taxTag','review_required'),'requiresReview',true,'postsToLedger',false);
end $$;
create function clickbooks_us.rule_decision(t jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b uuid; rs jsonb; r jsonb;
begin
 if not clickbooks_us.rule_eligible(t) then return jsonb_build_object('state','protected'); end if;
 select id into strict b from clickbooks_us.books where code='KTC_US';
 with matches as(select *,min(priority) over() best from clickbooks_us.rules where book_id=b and enabled and clickbooks_us.rule_matches(conditions,t))
 select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'action',action) order by id) into rs from matches where priority=best;
 if rs is null then return jsonb_build_object('state','unmatched'); end if;
 if jsonb_array_length(rs)>1 then return jsonb_build_object('state','conflict','ruleIds',(select jsonb_agg(x->>'id') from jsonb_array_elements(rs)x)); end if;
 r:=rs->0;
 return jsonb_build_object('state','matched','ruleId',r->>'id','revision',r->'revision','sourceId',t->>'id','sourceHash',md5(t::text),'outcome',clickbooks_us.rule_outcome(r->'action',t));
end $$;
create function clickbooks_us.save_rule(p_id uuid,p_expected int,d jsonb,p_actor uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare b uuid; r clickbooks_us.rules%rowtype;
begin
 perform clickbooks_us.validate_rule(d);
 select id into strict b from clickbooks_us.books where code='KTC_US' for update;
 if p_id is null then
 if p_expected<>0 or p_expected is null then raise exception 'CB_RULE_REVISION_CONFLICT'; end if;
 insert into clickbooks_us.rules(book_id,name,priority,enabled,conditions,action,created_by,updated_by) values(b,trim(d->>'name'),(d->>'priority')::int,(d->>'enabled')::boolean,d->'conditions',d->'action',p_actor,p_actor) returning * into r;
 else
 select * into strict r from clickbooks_us.rules where id=p_id and book_id=b for update;
 if r.revision is distinct from p_expected then raise exception 'CB_RULE_REVISION_CONFLICT'; end if;
 update clickbooks_us.rules set name=trim(d->>'name'),priority=(d->>'priority')::int,enabled=(d->>'enabled')::boolean,conditions=d->'conditions',action=d->'action',revision=revision+1,updated_by=p_actor,updated_at=now() where id=p_id returning * into r;
 end if;
 insert into clickbooks_us.rule_versions(rule_id,revision,definition,actor_id) values(r.id,r.revision,d,p_actor);
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('rule_saved',r.id,p_actor,jsonb_build_object('revision',r.revision,'enabled',r.enabled));
 return r.id;
end $$;
create function clickbooks_us.preview_rule(d jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare t jsonb; ls jsonb:='[]'; n int:=0; protected int:=0;
begin
 perform clickbooks_us.validate_rule(d);
 for t in select value from jsonb_array_elements(clickbooks_us.source_snapshot(current_date)->'bank') loop
 if not clickbooks_us.rule_eligible(t) then protected:=protected+1;
 elsif clickbooks_us.rule_matches(d->'conditions',t) then
 n:=n+1; if n<=200 then ls:=ls||jsonb_build_array(jsonb_build_object('id',t->>'id','date',t->>'date','description',t->>'name','amount',t->>'amount','direction',t->>'direction','outcome',clickbooks_us.rule_outcome(d->'action',t))); end if;
 end if;
 end loop;
 return jsonb_build_object('matching',n,'protected',protected,'rows',ls,'truncated',n>200,'saved',false,'note','Single-rule preview only. Staging evaluates enabled-rule priority and refuses ties.');
end $$;
create function clickbooks_us.stage_rule_proposals(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b uuid; t jsonb; d jsonb; n int:=0; conflicts int:=0; protected int:=0; changed int; h text;
begin
 select id into strict b from clickbooks_us.books where code='KTC_US' for update;
 for t in select value from jsonb_array_elements(clickbooks_us.source_snapshot(current_date)->'bank') loop
 d:=clickbooks_us.rule_decision(t); h:=md5(t::text);
 update clickbooks_us.rule_proposals set state='superseded',decided_at=now(),reason='Source, rule revision or winning rule changed' where book_id=b and source_id=(t->>'id')::uuid and state in ('proposed','approved') and (source_hash<>h or d->>'state'<>'matched' or rule_id::text is distinct from d->>'ruleId' or rule_revision is distinct from (d->>'revision')::int);
 if d->>'state'='conflict' then conflicts:=conflicts+1;
 elsif d->>'state'='protected' then protected:=protected+1;
 elsif d->>'state'='matched' then
 insert into clickbooks_us.rule_proposals(book_id,source_id,source_hash,rule_id,rule_revision,outcome,created_by) values(b,(t->>'id')::uuid,h,(d->>'ruleId')::uuid,(d->>'revision')::int,d->'outcome',p_actor) on conflict do nothing;
 get diagnostics changed=row_count; n:=n+changed;
 end if;
 end loop;
 insert into clickbooks_us.workflow_events(kind,actor_id,details) values('rule_stage',p_actor,jsonb_build_object('created',n,'conflicts',conflicts,'protected',protected));
 return jsonb_build_object('created',n,'conflicts',conflicts,'protected',protected,'ledgerPostings',0);
end $$;
create function clickbooks_us.decide_proposal(p_id uuid,p_accept boolean,p_reason text,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare p clickbooks_us.rule_proposals%rowtype; t jsonb; d jsonb; b uuid; x jsonb;
begin
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 or p_accept is null then raise exception 'CB_REVIEW_REASON_REQUIRED'; end if;
 select id into strict b from clickbooks_us.books where code='KTC_US' for update;
 select * into strict p from clickbooks_us.rule_proposals where id=p_id and book_id=b for update;
 if p.state=(case when p_accept then 'approved' else 'dismissed' end) then return; end if;
 if p.state<>'proposed' then raise exception 'CB_PROPOSAL_NOT_PENDING'; end if;
 if p_accept then
 select value into t from jsonb_array_elements(clickbooks_us.source_snapshot(current_date)->'bank') where value->>'id'=p.source_id::text;
 if t is null or md5(t::text)<>p.source_hash then raise exception 'CB_STALE_PROPOSAL'; end if;
 d:=clickbooks_us.rule_decision(t);
 if d->>'state'<>'matched' or d->>'ruleId'<>p.rule_id::text or (d->>'revision')::int<>p.rule_revision or d->'outcome'<>p.outcome then raise exception 'CB_STALE_PROPOSAL'; end if;
 if p.outcome->>'kind'<>'categorize' then raise exception 'CB_MATCH_REQUIRES_SEPARATE_REVIEW'; end if;
 for x in select value from jsonb_array_elements(p.outcome->'allocations') loop
 if clickbooks_us.cents(x->>'amountCents')=0 or not exists(select 1 from clickbooks_us.accounts where id=(x->>'accountId')::uuid and book_id=b and is_active and not needs_review and not is_bank_sensitive) then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if;
 end loop;
 end if;
 update clickbooks_us.rule_proposals set state=case when p_accept then 'approved' else 'dismissed' end,decided_by=p_actor,decided_at=now(),reason=trim(p_reason) where id=p_id;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('proposal_decided',p_id,p_actor,jsonb_build_object('approved',p_accept,'reason',trim(p_reason),'ledgerPostings',0));
end $$;
revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
