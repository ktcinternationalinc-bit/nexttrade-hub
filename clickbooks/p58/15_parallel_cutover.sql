-- ClickBooks US P7/P8: shadow posting, parallel reconciliation, controlled Wave write cutover.
alter table clickbooks_us.operator_grants add column can_manage_cutover boolean not null default false;
alter table clickbooks_us.rule_proposals add column posted_journal_id uuid references clickbooks_us.journals(id);
create unique index cb_rule_proposal_posted_journal on clickbooks_us.rule_proposals(posted_journal_id) where posted_journal_id is not null;

create table clickbooks_us.posting_defaults (
  book_id uuid primary key references clickbooks_us.books(id),
  invoice_income_account_id uuid,
  reviewed boolean not null default false,
  evidence text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  foreign key(book_id,invoice_income_account_id) references clickbooks_us.accounts(book_id,id),
  check(not reviewed or (invoice_income_account_id is not null and evidence is not null and length(btrim(evidence))>=10))
);
insert into clickbooks_us.posting_defaults(book_id) select id from clickbooks_us.books where code='KTC_US' on conflict do nothing;

create table clickbooks_us.cutover_control (
  singleton boolean primary key default true check(singleton),
  phase text not null default 'wave_primary' check(phase in ('wave_primary','parallel','clickbooks_primary','rollback_review')),
  shadow_sync_enabled boolean not null default false,
  cutover_execution_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into clickbooks_us.cutover_control(singleton) values(true) on conflict do nothing;

create table clickbooks_us.shadow_sync_runs (
  id uuid primary key default gen_random_uuid(),
  from_date date not null,
  to_date date not null,
  source_fingerprint text not null,
  result jsonb not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create table clickbooks_us.cutover_runs (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  from_date date not null,
  to_date date not null,
  state text not null default 'staged' check(state in ('staged','approved','executed','rolled_back')),
  snapshot jsonb not null,
  snapshot_hash text not null,
  evidence text not null,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  approval_hash text,
  executed_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now()
);
create table clickbooks_us.cutover_events (
  id bigint generated always as identity primary key,
  run_id uuid references clickbooks_us.cutover_runs(id),
  event text not null,
  actor_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create trigger cb_cutover_events_append_only before update or delete on clickbooks_us.cutover_events for each row execute function clickbooks_us.deny_mutation();

do $$ declare t text; begin
 foreach t in array array['posting_defaults','cutover_control','shadow_sync_runs','cutover_runs','cutover_events'] loop
  execute format('alter table clickbooks_us.%I enable row level security',t);
  execute format('revoke all on table clickbooks_us.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on all sequences in schema clickbooks_us from public,anon,authenticated,service_role;

create function clickbooks_us.set_posting_default(p_income_account uuid,p_evidence text,p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$ declare b uuid; a clickbooks_us.accounts%rowtype; begin
 if p_actor is null or p_evidence is null or length(btrim(p_evidence))<10 then raise exception 'CB_POSTING_DEFAULT_EVIDENCE'; end if;
 select id into strict b from clickbooks_us.books where code='KTC_US' for update;
 select * into strict a from clickbooks_us.accounts where book_id=b and id=p_income_account;
 if a.account_type<>'income' or not a.is_active or a.needs_review or a.is_bank_sensitive then raise exception 'CB_POSTING_DEFAULT_ACCOUNT'; end if;
 update clickbooks_us.posting_defaults set invoice_income_account_id=p_income_account,reviewed=true,evidence=btrim(p_evidence),reviewed_by=p_actor,reviewed_at=now() where book_id=b;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('posting_default_reviewed',p_income_account,p_actor,jsonb_build_object('evidence',left(btrim(p_evidence),200)));
end $$;

create function clickbooks_us.certify_historical_books(p_cutoff date,p_evidence text,p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$ declare b clickbooks_us.books%rowtype; begin
 if p_actor is null or p_evidence is null or length(btrim(p_evidence))<20 or p_cutoff is null or not isfinite(p_cutoff) then raise exception 'CB_CERTIFICATION_EVIDENCE'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US' for update;
 if b.opening_cutoff is distinct from p_cutoff and not exists(select 1 from clickbooks_us.migration_runs where book_id=b.id and state='committed' and cutoff=p_cutoff) then raise exception 'CB_CERTIFICATION_CUTOFF'; end if;
 if not exists(select 1 from clickbooks_us.journals where book_id=b.id and status='posted') then raise exception 'CB_CERTIFICATION_EMPTY'; end if;
 if exists(select 1 from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id join clickbooks_us.journals j on j.id=l.journal_id where j.book_id=b.id and j.status='posted' and a.needs_review) then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if;
 if exists(select 1 from clickbooks_us.trial_balance(b.id,p_cutoff) where debit_cents<0 or credit_cents<0) then raise exception 'CB_CERTIFICATION_INVALID_LEDGER'; end if;
 update clickbooks_us.books set historical_data_ready=true where id=b.id;
 insert into clickbooks_us.workflow_events(kind,actor_id,details) values('historical_books_certified',p_actor,jsonb_build_object('cutoff',p_cutoff,'evidence',left(btrim(p_evidence),500)));
end $$;

create function clickbooks_us.shadow_sync_preview(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; src text; invoice_count int; payment_count int; rule_count int; invoice_block int; payment_block int; rule_block int; begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_to-p_from>400 then raise exception 'CB_SHADOW_PERIOD'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US'; src:=b.wave_business_id;
 select count(*),count(*) filter(where not exists(select 1 from public.accounting_invoice_items li where li.invoice_id=i.id) or coalesce(i.total_amount,0)<=0 or coalesce(i.amount_paid,0)<>(select coalesce(sum(p.amount),0) from public.accounting_invoice_payments p where p.accounting_invoice_id=i.id and p.wave_business_id=src and p.voided is not true)) into invoice_count,invoice_block
 from public.accounting_invoices i where i.wave_business_id=src and i.currency='USD' and i.record_status='active' and i.approval_status='approved' and i.invoice_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=i.id::text);
 select count(*),count(*) filter(where p.bank_transaction_id is null or not exists(select 1 from public.bank_transactions t where t.id=p.bank_transaction_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD') or not exists(select 1 from clickbooks_us.bank_ledger_map m where m.book_id=b.id and m.provider_account_id=(select t.account_id from public.bank_transactions t where t.id=p.bank_transaction_id) and m.reviewed)) into payment_count,payment_block
 from public.accounting_invoice_payments p join public.accounting_invoices i on i.id=p.accounting_invoice_id and i.wave_business_id=src and i.currency='USD' where p.wave_business_id=src and p.voided is not true and p.payment_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice_payment' and j.source_id=p.id::text);
 select count(*),count(*) filter(where q.posted_journal_id is null and (r.enabled is false or q.rule_revision<>r.revision)) into rule_count,rule_block
 from clickbooks_us.rule_proposals q join clickbooks_us.rules r on r.id=q.rule_id where q.book_id=b.id and q.state='approved' and q.posted_journal_id is null;
 return jsonb_build_object('scope','KTC_US','from',p_from,'to',p_to,'historyReady',b.historical_data_ready,'openingCutoff',b.opening_cutoff,
  'postingDefaultReady',exists(select 1 from clickbooks_us.posting_defaults d join clickbooks_us.accounts a on a.id=d.invoice_income_account_id and a.book_id=d.book_id where d.book_id=b.id and d.reviewed and a.is_active and not a.needs_review and a.account_type='income'),
  'candidates',jsonb_build_object('invoices',invoice_count,'payments',payment_count,'approvedRuleBankTransactions',rule_count),
  'blocked',jsonb_build_object('invoices',invoice_block,'payments',payment_block,'ruleProposals',rule_block),
  'bankMappingsReviewed',(select count(*) from clickbooks_us.bank_ledger_map where book_id=b.id and reviewed),
  'postsNow',false,'note','Preview only. Shadow posting requires certified opening/history, reviewed posting defaults and bank mappings, and a separate disabled-by-default execution switch.');
end $$;

create function clickbooks_us.shadow_sync_run(p_from date,p_to date,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text; ar uuid; income uuid; i record; p record; q record; bank record; bank_gl uuid; lines jsonb; jid uuid; invoice_posted int:=0; payment_posted int:=0; rules_posted int:=0; skipped int:=0; result jsonb; snapshot text; alloc jsonb; alloc_lines jsonb; n bigint; begin
 if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
 if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US' for update; select * into strict c from clickbooks_us.cutover_control where singleton for update; src:=b.wave_business_id;
 if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
 if b.opening_cutoff is null or p_from<=b.opening_cutoff or p_from>p_to or p_to>current_date+1 or p_to-p_from>31 then raise exception 'CB_SHADOW_PERIOD'; end if;
 select id into strict ar from clickbooks_us.accounts where book_id=b.id and code='1100';
 select d.invoice_income_account_id into income from clickbooks_us.posting_defaults d join clickbooks_us.accounts a on a.id=d.invoice_income_account_id and a.book_id=d.book_id where d.book_id=b.id and d.reviewed and a.is_active and not a.needs_review and a.account_type='income';
 if income is null then raise exception 'CB_POSTING_DEFAULT_ACCOUNT'; end if;
 snapshot:=md5(clickbooks_us.source_snapshot(p_to)::text);
 for i in select * from public.accounting_invoices x where x.wave_business_id=src and x.currency='USD' and x.record_status='active' and x.approval_status='approved' and x.invoice_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=x.id::text) order by x.invoice_date,x.id loop
  if not exists(select 1 from public.accounting_invoice_items li where li.invoice_id=i.id) or coalesce(i.total_amount,0)<=0 or coalesce(i.amount_paid,0)<>(select coalesce(sum(pp.amount),0) from public.accounting_invoice_payments pp where pp.accounting_invoice_id=i.id and pp.wave_business_id=src and pp.voided is not true) then skipped:=skipped+1; continue; end if;
  n:=clickbooks_us.money_cents(i.total_amount::text); lines:=jsonb_build_array(jsonb_build_object('account_id',ar,'debit_cents',n::text,'credit_cents','0'),jsonb_build_object('account_id',income,'debit_cents','0','credit_cents',n::text));
  perform clickbooks_us.post_journal(b.id,i.invoice_date,'Invoice '||coalesce(i.invoice_number,i.id::text),'accounting_invoice',i.id::text,lines,p_actor); invoice_posted:=invoice_posted+1;
 end loop;
 for p in select pp.* from public.accounting_invoice_payments pp join public.accounting_invoices ii on ii.id=pp.accounting_invoice_id and ii.wave_business_id=src and ii.currency='USD' where pp.wave_business_id=src and pp.voided is not true and pp.payment_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice_payment' and j.source_id=pp.id::text) order by pp.payment_date,pp.id loop
  if not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=p.accounting_invoice_id::text and j.status='posted') then skipped:=skipped+1; continue; end if;
  select t.* into bank from public.bank_transactions t where t.id=p.bank_transaction_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD'; if not found then skipped:=skipped+1; continue; end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=bank.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive; if bank_gl is null then skipped:=skipped+1; continue; end if;
  n:=clickbooks_us.money_cents(p.amount::text); lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents',n::text,'credit_cents','0'),jsonb_build_object('account_id',ar,'debit_cents','0','credit_cents',n::text));
  perform clickbooks_us.post_journal(b.id,p.payment_date,'Invoice payment '||p.id::text,'accounting_invoice_payment',p.id::text,lines,p_actor); payment_posted:=payment_posted+1;
 end loop;
 for q in select qp.*,r.enabled,r.revision current_revision from clickbooks_us.rule_proposals qp join clickbooks_us.rules r on r.id=qp.rule_id where qp.book_id=b.id and qp.state='approved' and qp.posted_journal_id is null order by qp.created_at,qp.id loop
  if not q.enabled or q.rule_revision<>q.current_revision or q.outcome->>'kind'<>'categorize' then skipped:=skipped+1; continue; end if;
  select t.* into bank from public.bank_transactions t where t.id=q.source_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD' and t.review_status='unreviewed' and t.classification is null and t.linked_id is null and t.matched_invoice_id is null; if not found or bank.date not between p_from and p_to then continue; end if;
  if md5((select value::text from jsonb_array_elements(clickbooks_us.source_snapshot(p_to)->'bank') where value->>'id'=bank.id::text))<>q.source_hash then skipped:=skipped+1; continue; end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=bank.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive; if bank_gl is null then skipped:=skipped+1; continue; end if;
  n:=clickbooks_us.money_cents(bank.amount_abs::text); alloc_lines:='[]'::jsonb;
  for alloc in select value from jsonb_array_elements(q.outcome->'allocations') loop
   if not exists(select 1 from clickbooks_us.accounts a where a.book_id=b.id and a.id=(alloc->>'accountId')::uuid and a.is_active and not a.needs_review and not a.is_bank_sensitive) then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if;
   if bank.direction='out' then alloc_lines:=alloc_lines||jsonb_build_array(jsonb_build_object('account_id',alloc->>'accountId','debit_cents',alloc->>'amountCents','credit_cents','0')); else alloc_lines:=alloc_lines||jsonb_build_array(jsonb_build_object('account_id',alloc->>'accountId','debit_cents','0','credit_cents',alloc->>'amountCents')); end if;
  end loop;
  if bank.direction='out' then lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents','0','credit_cents',n::text))||alloc_lines; else lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents',n::text,'credit_cents','0'))||alloc_lines; end if;
  jid:=clickbooks_us.post_journal(b.id,coalesce(bank.posted_date,bank.date),'Rule-classified bank transaction '||bank.id::text,'bank_transaction',bank.id::text,lines,p_actor); update clickbooks_us.rule_proposals set posted_journal_id=jid where id=q.id; rules_posted:=rules_posted+1;
 end loop;
 result:=jsonb_build_object('from',p_from,'to',p_to,'invoicesPosted',invoice_posted,'paymentsPosted',payment_posted,'ruleBankTransactionsPosted',rules_posted,'skippedForReview',skipped,'sourceFingerprint',snapshot);
 insert into clickbooks_us.shadow_sync_runs(from_date,to_date,source_fingerprint,result,actor_id) values(p_from,p_to,snapshot,result,p_actor);
 insert into clickbooks_us.workflow_events(kind,actor_id,details) values('shadow_sync_completed',p_actor,result); return result;
end $$;

create function clickbooks_us.parallel_status(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare b clickbooks_us.books%rowtype; src text; preview jsonb; wave jsonb; ready boolean; blockers jsonb; begin
 select * into strict b from clickbooks_us.books where code='KTC_US'; src:=b.wave_business_id; preview:=clickbooks_us.shadow_sync_preview(p_from,p_to);
 select jsonb_build_object('writesEnabled',writes_enabled,'customerPush',allow_customer_push,'invoicePush',allow_invoice_push,'paymentPush',allow_payment_push,'categoryPush',allow_category_push,'autoPush',allow_auto_push,'productionUnlocked',production_push_unlocked) into wave from public.wave_business_registry where wave_business_id=src;
 blockers:=jsonb_build_array();
 if not b.historical_data_ready then blockers:=blockers||jsonb_build_array('Historical books are not certified'); end if;
 if b.opening_cutoff is null then blockers:=blockers||jsonb_build_array('Opening/cutoff basis is not established'); end if;
 if (preview#>>'{candidates,invoices}')::int>0 or (preview#>>'{candidates,payments}')::int>0 or (preview#>>'{candidates,approvedRuleBankTransactions}')::int>0 then blockers:=blockers||jsonb_build_array('Supported source events remain unposted'); end if;
 if (preview#>>'{blocked,invoices}')::int>0 or (preview#>>'{blocked,payments}')::int>0 or (preview#>>'{blocked,ruleProposals}')::int>0 then blockers:=blockers||jsonb_build_array('Source events are blocked for review'); end if;
 if exists(select 1 from clickbooks_us.accounts where book_id=b.id and needs_review and exists(select 1 from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id=l.journal_id where l.account_id=accounts.id and j.status='posted')) then blockers:=blockers||jsonb_build_array('Posted ledger uses an account still marked for review'); end if;
 if exists(select 1 from clickbooks_us.trial_balance(b.id,p_to) where debit_cents<0 or credit_cents<0) then blockers:=blockers||jsonb_build_array('Trial balance contains invalid sign totals'); end if;
 ready:=jsonb_array_length(blockers)=0;
 return jsonb_build_object('scope','KTC_US','from',p_from,'to',p_to,'phase',(select phase from clickbooks_us.cutover_control where singleton),'ready',ready,'blockers',blockers,'shadowPreview',preview,'wave',wave,'reporting',clickbooks_us.reporting_readiness(),'bankFeed',(select jsonb_build_object('activeConnections',count(*),'latestSync',max(last_successful_plaid_sync_at),'latestPostedDate',max(last_successful_posted_date)) from public.bank_connections where wave_business_id=src and status='active'));
end $$;

create function clickbooks_us.create_cutover_run(p_key uuid,p_from date,p_to date,p_evidence text,p_actor uuid) returns uuid
language plpgsql security invoker set search_path='' as $$ declare s jsonb; r clickbooks_us.cutover_runs%rowtype; begin
 if p_key is null or p_actor is null or p_evidence is null or length(btrim(p_evidence))<20 then raise exception 'CB_CUTOVER_EVIDENCE'; end if; perform pg_advisory_xact_lock(hashtextextended(p_key::text,0)); select * into r from clickbooks_us.cutover_runs where request_key=p_key;
 if found then if r.from_date=p_from and r.to_date=p_to then return r.id; else raise exception 'CB_IDEMPOTENCY_CONFLICT'; end if; end if;
 s:=clickbooks_us.parallel_status(p_from,p_to); insert into clickbooks_us.cutover_runs(request_key,from_date,to_date,snapshot,snapshot_hash,evidence,created_by) values(p_key,p_from,p_to,s,md5(s::text),btrim(p_evidence),p_actor) returning * into r;
 insert into clickbooks_us.cutover_events(run_id,event,actor_id,details) values(r.id,'staged',p_actor,jsonb_build_object('ready',s->'ready')); return r.id; end $$;

create function clickbooks_us.cutover_fingerprint(p_run uuid) returns text language sql stable security invoker set search_path='' as $$ select md5(jsonb_build_object('snapshot',r.snapshot_hash,'current',clickbooks_us.parallel_status(r.from_date,r.to_date),'ledger',(select jsonb_agg(jsonb_build_object('id',j.id,'hash',j.payload_hash) order by j.id) from clickbooks_us.journals j where j.status='posted'),'control',(select to_jsonb(c) from clickbooks_us.cutover_control c where c.singleton))::text) from clickbooks_us.cutover_runs r where r.id=p_run $$;

create function clickbooks_us.approve_cutover(p_run uuid,p_actor uuid) returns text
language plpgsql security invoker set search_path='' as $$ declare r clickbooks_us.cutover_runs%rowtype; s jsonb; h text; begin
 if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if; select * into strict r from clickbooks_us.cutover_runs where id=p_run for update; if r.state<>'staged' then raise exception 'CB_CUTOVER_STATE'; end if;
 s:=clickbooks_us.parallel_status(r.from_date,r.to_date); if s->>'ready'<>'true' then raise exception 'CB_CUTOVER_BLOCKED'; end if; if md5(s::text)<>r.snapshot_hash then raise exception 'CB_CUTOVER_SNAPSHOT_STALE'; end if;
 h:=clickbooks_us.cutover_fingerprint(r.id); update clickbooks_us.cutover_runs set state='approved',approved_by=p_actor,approved_at=now(),approval_hash=h where id=r.id; insert into clickbooks_us.cutover_events(run_id,event,actor_id) values(r.id,'approved',p_actor); return h; end $$;

create function clickbooks_us.execute_wave_cutover(p_run uuid,p_hash text,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare r clickbooks_us.cutover_runs%rowtype; b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; before_flags jsonb; begin
 if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if; if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US' for update; select * into strict c from clickbooks_us.cutover_control where singleton for update; select * into strict r from clickbooks_us.cutover_runs where id=p_run for update;
 if r.state='executed' and r.approval_hash=p_hash then return jsonb_build_object('state','executed','replayed',true); end if;
 if not c.cutover_execution_enabled or not b.historical_data_ready or c.phase<>'parallel' or r.state<>'approved' or r.approval_hash is distinct from p_hash or r.approval_hash is distinct from clickbooks_us.cutover_fingerprint(r.id) then raise exception 'CB_CUTOVER_EXECUTION_DISABLED_OR_STALE'; end if;
 if (clickbooks_us.parallel_status(r.from_date,r.to_date)->>'ready')<>'true' then raise exception 'CB_CUTOVER_BLOCKED'; end if;
 select jsonb_build_object('writes_enabled',writes_enabled,'allow_customer_push',allow_customer_push,'allow_invoice_push',allow_invoice_push,'allow_payment_push',allow_payment_push,'allow_category_push',allow_category_push,'allow_auto_push',allow_auto_push,'production_push_unlocked',production_push_unlocked) into before_flags from public.wave_business_registry where wave_business_id=b.wave_business_id for update;
 update public.wave_business_registry set writes_enabled=false,allow_customer_push=false,allow_invoice_push=false,allow_payment_push=false,allow_category_push=false,allow_auto_push=false,production_push_unlocked=false where wave_business_id=b.wave_business_id;
 update clickbooks_us.cutover_control set phase='clickbooks_primary',cutover_execution_enabled=false,updated_by=p_actor,updated_at=now() where singleton;
 update clickbooks_us.cutover_runs set state='executed',executed_at=now() where id=r.id;
 insert into clickbooks_us.cutover_events(run_id,event,actor_id,details) values(r.id,'executed',p_actor,jsonb_build_object('waveBefore',before_flags,'bankFeedsChanged',false));
 return jsonb_build_object('state','executed','waveWritesDisabled',true,'bankFeedsChanged',false); end $$;

create function clickbooks_us.rollback_wave_cutover(p_run uuid,p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$ declare r clickbooks_us.cutover_runs%rowtype; b clickbooks_us.books%rowtype; flags jsonb; begin
 if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if; select * into strict b from clickbooks_us.books where code='KTC_US' for update; select * into strict r from clickbooks_us.cutover_runs where id=p_run for update;
 if r.state='rolled_back' then return; end if; if r.state<>'executed' then raise exception 'CB_CUTOVER_STATE'; end if;
 select details->'waveBefore' into flags from clickbooks_us.cutover_events where run_id=r.id and event='executed' order by id desc limit 1; if flags is null then raise exception 'CB_CUTOVER_ROLLBACK_EVIDENCE'; end if;
 update public.wave_business_registry set writes_enabled=(flags->>'writes_enabled')::boolean,allow_customer_push=(flags->>'allow_customer_push')::boolean,allow_invoice_push=(flags->>'allow_invoice_push')::boolean,allow_payment_push=(flags->>'allow_payment_push')::boolean,allow_category_push=(flags->>'allow_category_push')::boolean,allow_auto_push=(flags->>'allow_auto_push')::boolean,production_push_unlocked=(flags->>'production_push_unlocked')::boolean where wave_business_id=b.wave_business_id;
 update clickbooks_us.cutover_control set phase='rollback_review',shadow_sync_enabled=false,cutover_execution_enabled=false,updated_by=p_actor,updated_at=now() where singleton;
 update clickbooks_us.cutover_runs set state='rolled_back',rolled_back_at=now() where id=r.id; insert into clickbooks_us.cutover_events(run_id,event,actor_id) values(r.id,'rolled_back',p_actor); end $$;

create function public.clickbooks_us_cutover_read(p_from date,p_to date) returns jsonb language sql stable security definer set search_path='' as $$ select jsonb_build_object('status',clickbooks_us.parallel_status(p_from,p_to),'runs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'from',from_date,'to',to_date,'state',state,'createdAt',created_at,'approvedAt',approved_at,'executedAt',executed_at,'rolledBackAt',rolled_back_at) order by created_at desc) from (select * from clickbooks_us.cutover_runs order by created_at desc limit 50)x),'[]'::jsonb),'control',(select jsonb_build_object('phase',phase,'shadowSyncEnabled',shadow_sync_enabled,'cutoverExecutionEnabled',cutover_execution_enabled) from clickbooks_us.cutover_control where singleton)) $$;
create function public.clickbooks_us_cutover_stage(p_key uuid,p_from date,p_to date,p_evidence text,p_actor uuid) returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('runId',clickbooks_us.create_cutover_run(p_key,p_from,p_to,p_evidence,p_actor),'executed',false) $$;
create function public.clickbooks_us_shadow_sync_job(p_from date,p_to date,p_actor uuid) returns jsonb language sql security definer set search_path='' as $$ select clickbooks_us.shadow_sync_run(p_from,p_to,p_actor) $$;

revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
revoke all on function public.clickbooks_us_cutover_read(date,date),public.clickbooks_us_cutover_stage(uuid,date,date,text,uuid),public.clickbooks_us_shadow_sync_job(date,date,uuid) from public,anon,authenticated;
grant execute on function public.clickbooks_us_cutover_read(date,date),public.clickbooks_us_cutover_stage(uuid,date,date,text,uuid),public.clickbooks_us_shadow_sync_job(date,date,uuid) to service_role;
