create function clickbooks_us.approve_migration(p_run uuid,p_revision int,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r clickbooks_us.migration_runs%rowtype; begin
 if p_actor is null then raise exception 'CB_APPROVER_REQUIRED'; end if;
 perform 1 from clickbooks_us.books where code='KTC_US' for update;
 select * into strict r from clickbooks_us.migration_runs where id=p_run for update;
 if r.state<>'staged' or r.revision is distinct from p_revision then raise exception 'CB_MIGRATION_REVISION_CONFLICT'; end if;
 perform clickbooks_us.validate_migration(p_run);
 update clickbooks_us.migration_runs set state='approved',approved_by=p_actor,approved_at=now(),approval_hash=clickbooks_us.migration_fingerprint(p_run) where id=p_run;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id) values('migration_approved',p_run,p_actor);
end $$;
create function clickbooks_us.commit_migration(p_run uuid,p_approval_hash text,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r clickbooks_us.migration_runs%rowtype; b clickbooks_us.books%rowtype; e jsonb; jid uuid; n int:=0; begin
 if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US' for update;
 select * into strict r from clickbooks_us.migration_runs where id=p_run and book_id=b.id for update;
 if r.state='committed' and r.approval_hash=p_approval_hash then return jsonb_build_object('state','committed','runId',r.id,'replayed',true); end if;
 if p_actor is null or not b.posting_enabled or not (select migration_execution_enabled from clickbooks_us.workflow_settings where singleton) then raise exception 'CB_MIGRATION_EXECUTION_DISABLED'; end if;
 if r.state<>'approved' or r.approval_hash is distinct from p_approval_hash or r.approval_hash is distinct from clickbooks_us.migration_fingerprint(p_run) then raise exception 'CB_APPROVAL_STALE'; end if;
 perform clickbooks_us.validate_migration(p_run);
 for e in select value from jsonb_array_elements(r.plans) loop
 n:=n+1; jid:=clickbooks_us.post_journal(b.id,(e->>'date')::date,e->>'description',e->>'source_kind',e->>'source_id',e->'lines',p_actor);
 insert into clickbooks_us.migration_postings(run_id,ordinal,journal_id) values(r.id,n,jid);
 end loop;
 if r.strategy='opening_balance' then
 for e in select value from jsonb_array_elements(r.opening_subledger) loop
 insert into clickbooks_us.opening_subledger(run_id,book_id,kind,source_ref,account_id,amount_cents) values(r.id,b.id,e->>'kind',e->>'source_ref',(e->>'account_id')::uuid,clickbooks_us.cents(e->>'amount_cents'));
 end loop;
 update clickbooks_us.books set opening_cutoff=r.cutoff where id=b.id;
 end if;
 update clickbooks_us.migration_runs set state='committed',committed_at=now() where id=r.id;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('migration_committed',r.id,p_actor,jsonb_build_object('journals',n,'historyReady',false));
 return jsonb_build_object('state','committed','runId',r.id,'journals',n,'historyReady',false);
end $$;
create function clickbooks_us.reverse_migration(p_run uuid,p_date date,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r clickbooks_us.migration_runs%rowtype; x record; rid uuid; begin
 perform 1 from clickbooks_us.books where code='KTC_US' for update;
 select * into strict r from clickbooks_us.migration_runs where id=p_run for update;
 if r.state='reversed' and r.reversal_date=p_date then return; end if;
 if r.state<>'committed' or p_actor is null or p_date is null or p_date<r.cutoff or not isfinite(p_date) then raise exception 'CB_REVERSAL_NOT_ALLOWED'; end if;
 if exists(select 1 from clickbooks_us.journals j where j.book_id=r.book_id and j.status='posted' and j.created_at>=r.committed_at and not exists(select 1 from clickbooks_us.migration_postings m where m.run_id=r.id and m.journal_id=j.id)) then raise exception 'CB_LATER_POSTINGS_REQUIRE_MANUAL_UNWIND'; end if;
 for x in select * from clickbooks_us.migration_postings where run_id=r.id order by ordinal desc loop
 rid:=clickbooks_us.reverse_journal(x.journal_id,p_date,'Migration batch reversal '||r.id::text,p_actor);
 update clickbooks_us.migration_postings set reversal_id=rid where run_id=r.id and ordinal=x.ordinal;
 end loop;
 update clickbooks_us.migration_runs set state='reversed',reversal_date=p_date where id=r.id;
 update clickbooks_us.books set posting_enabled=false,historical_data_ready=false where id=r.book_id;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('migration_reversed',r.id,p_actor,jsonb_build_object('postingLocked',true));
end $$;
create function clickbooks_us.guard_opening_cutoff() returns trigger language plpgsql security invoker set search_path='' as $$
declare cutoff date; begin
 select opening_cutoff into cutoff from clickbooks_us.books where id=NEW.book_id;
 if cutoff is not null and NEW.source_kind not in ('reversal') and NEW.entry_date<=cutoff then raise exception 'CB_PRE_CUTOFF_EVENT'; end if;
 return NEW;
end $$;
create trigger cb_opening_cutoff before insert or update on clickbooks_us.journals for each row execute function clickbooks_us.guard_opening_cutoff();
revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
