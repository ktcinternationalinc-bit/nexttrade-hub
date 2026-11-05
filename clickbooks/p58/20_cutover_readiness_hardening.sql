-- Reproduction SQL for clickbooks_us_p58_cutover_readiness_hardening_v1.
create or replace function clickbooks_us.parallel_status(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; src text; preview jsonb; wave jsonb; ready boolean; blockers jsonb; latest_shadow timestamptz; missing_bank_maps int; begin
 select * into strict b from clickbooks_us.books where code='KTC_US'; src:=b.wave_business_id; preview:=clickbooks_us.shadow_sync_preview(p_from,p_to);
 select jsonb_build_object('writesEnabled',writes_enabled,'customerPush',allow_customer_push,'invoicePush',allow_invoice_push,'paymentPush',allow_payment_push,'categoryPush',allow_category_push,'autoPush',allow_auto_push,'productionUnlocked',production_push_unlocked) into wave from public.wave_business_registry where wave_business_id=src;
 select max(created_at) into latest_shadow from clickbooks_us.shadow_sync_runs where to_date>=p_to-1 and to_date<=p_to;
 select count(*) into missing_bank_maps from public.plaid_accounts p join public.bank_connections c on c.id=p.connection_id
 where c.wave_business_id=src and c.status='active' and not exists(
  select 1 from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id
  where m.book_id=b.id and m.provider_account_id=p.plaid_account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive and a.account_type in ('asset','liability')
 );
 blockers:=jsonb_build_array();
 if (select phase from clickbooks_us.cutover_control where singleton)<>'parallel' then blockers:=blockers||jsonb_build_array('ClickBooks is not in parallel phase'); end if;
 if not (select shadow_sync_enabled from clickbooks_us.cutover_control where singleton) then blockers:=blockers||jsonb_build_array('Shadow synchronization is not enabled'); end if;
 if not b.historical_data_ready then blockers:=blockers||jsonb_build_array('Historical books are not certified'); end if;
 if b.opening_cutoff is null then blockers:=blockers||jsonb_build_array('Opening/cutoff basis is not established'); end if;
 if (preview->>'postingDefaultReady')::boolean is not true then blockers:=blockers||jsonb_build_array('Future invoice revenue posting default is not reviewed'); end if;
 if missing_bank_maps>0 then blockers:=blockers||jsonb_build_array('One or more active bank accounts lack a reviewed ClickBooks ledger mapping'); end if;
 if latest_shadow is null or latest_shadow<now()-interval '36 hours' then blockers:=blockers||jsonb_build_array('No recent successful shadow synchronization covers the end of this review period'); end if;
 if (preview#>>'{candidates,invoices}')::int>0 or (preview#>>'{candidates,payments}')::int>0 or (preview#>>'{candidates,approvedRuleBankTransactions}')::int>0 then blockers:=blockers||jsonb_build_array('Supported source events remain unposted'); end if;
 if (preview#>>'{blocked,invoices}')::int>0 or (preview#>>'{blocked,payments}')::int>0 or (preview#>>'{blocked,ruleProposals}')::int>0 then blockers:=blockers||jsonb_build_array('Source events are blocked for review'); end if;
 if exists(select 1 from clickbooks_us.accounts aa where aa.book_id=b.id and aa.needs_review and exists(select 1 from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id=l.journal_id where l.account_id=aa.id and j.status='posted')) then blockers:=blockers||jsonb_build_array('Posted ledger uses an account still marked for review'); end if;
 if exists(select 1 from clickbooks_us.trial_balance(b.id,p_to) where debit_cents<0 or credit_cents<0) then blockers:=blockers||jsonb_build_array('Trial balance contains invalid sign totals'); end if;
 ready:=jsonb_array_length(blockers)=0;
 return jsonb_build_object('scope','KTC_US','from',p_from,'to',p_to,'phase',(select phase from clickbooks_us.cutover_control where singleton),'ready',ready,'blockers',blockers,'shadowPreview',preview,'latestShadowRun',latest_shadow,'missingActiveBankMappings',missing_bank_maps,'wave',wave,'reporting',clickbooks_us.reporting_readiness(),'bankFeed',(select jsonb_build_object('activeConnections',count(*),'latestSync',max(last_successful_plaid_sync_at),'latestPostedDate',max(last_successful_posted_date),'stale',coalesce(max(last_successful_plaid_sync_at)<now()-interval '48 hours',true)) from public.bank_connections where wave_business_id=src and status='active'));
end $$;

create or replace function clickbooks_us.create_cutover_run(p_key uuid,p_from date,p_to date,p_evidence text,p_actor uuid) returns uuid
language plpgsql security invoker set search_path='' as $$ declare s jsonb; r clickbooks_us.cutover_runs%rowtype; begin
 if p_key is null or p_actor is null or p_evidence is null or length(btrim(p_evidence))<20 then raise exception 'CB_CUTOVER_EVIDENCE'; end if;
 if p_to is distinct from current_date or p_from is null or p_from>p_to-7 or p_from<p_to-31 then raise exception 'CB_CUTOVER_REVIEW_WINDOW'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0)); select * into r from clickbooks_us.cutover_runs where request_key=p_key;
 if found then if r.from_date=p_from and r.to_date=p_to then return r.id; else raise exception 'CB_IDEMPOTENCY_CONFLICT'; end if; end if;
 s:=clickbooks_us.parallel_status(p_from,p_to); insert into clickbooks_us.cutover_runs(request_key,from_date,to_date,snapshot,snapshot_hash,evidence,created_by) values(p_key,p_from,p_to,s,md5(s::text),btrim(p_evidence),p_actor) returning * into r;
 insert into clickbooks_us.cutover_events(run_id,event,actor_id,details) values(r.id,'staged',p_actor,jsonb_build_object('ready',s->'ready')); return r.id; end $$;

create or replace function clickbooks_us.approve_cutover(p_run uuid,p_actor uuid) returns text
language plpgsql security invoker set search_path='' as $$ declare r clickbooks_us.cutover_runs%rowtype; s jsonb; h text; begin
 if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if; select * into strict r from clickbooks_us.cutover_runs where id=p_run for update; if r.state<>'staged' then raise exception 'CB_CUTOVER_STATE'; end if;
 if r.to_date is distinct from current_date or r.from_date>r.to_date-7 or r.from_date<r.to_date-31 then raise exception 'CB_CUTOVER_REVIEW_WINDOW'; end if;
 s:=clickbooks_us.parallel_status(r.from_date,r.to_date); if s->>'ready'<>'true' then raise exception 'CB_CUTOVER_BLOCKED'; end if; if md5(s::text)<>r.snapshot_hash then raise exception 'CB_CUTOVER_SNAPSHOT_STALE'; end if;
 h:=clickbooks_us.cutover_fingerprint(r.id); update clickbooks_us.cutover_runs set state='approved',approved_by=p_actor,approved_at=now(),approval_hash=h where id=r.id; insert into clickbooks_us.cutover_events(run_id,event,actor_id) values(r.id,'approved',p_actor); return h; end $$;
revoke all on function clickbooks_us.parallel_status(date,date),clickbooks_us.create_cutover_run(uuid,date,date,text,uuid),clickbooks_us.approve_cutover(uuid,uuid) from public,anon,authenticated,service_role;
