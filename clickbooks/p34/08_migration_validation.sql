-- Trusted-operator execution only. No public/service-role posting API is granted.
create table clickbooks_us.bank_ledger_map (
 book_id uuid not null references clickbooks_us.books(id), provider_account_id text not null,
 account_id uuid not null, reviewed boolean not null default false, evidence text,
 primary key(book_id,provider_account_id), foreign key(book_id,account_id) references clickbooks_us.accounts(book_id,id),
 check(not reviewed or (evidence is not null and length(trim(evidence))>=10))
);
alter table clickbooks_us.bank_ledger_map enable row level security;
revoke all on clickbooks_us.bank_ledger_map from public,anon,authenticated,service_role;
create function clickbooks_us.money_cents(p text) returns bigint language plpgsql immutable security invoker set search_path='' as $$
declare n numeric; begin
 if p is null or p !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'CB_INVALID_SOURCE_AMOUNT'; end if;
 n:=p::numeric*100;
 if n<>trunc(n) or n>999999999999999 then raise exception 'CB_INVALID_SOURCE_AMOUNT'; end if;
 return n::bigint;
end $$;
create function clickbooks_us.migration_fingerprint(p_run uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object('snapshot',r.snapshot_hash,'plans',r.plans,'expected',r.expected_balances,'subledger',r.opening_subledger,'evidence',r.evidence,
 'chart',(select jsonb_agg(to_jsonb(a) order by id) from clickbooks_us.accounts a where a.book_id=r.book_id),
 'bankMap',(select jsonb_agg(to_jsonb(m) order by provider_account_id) from clickbooks_us.bank_ledger_map m where m.book_id=r.book_id),
 'ledger',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',payload_hash,'status',status) order by id),'[]') from clickbooks_us.journals j where j.book_id=r.book_id),
 'lock',(select locked_through from clickbooks_us.books where id=r.book_id))::text)
 from clickbooks_us.migration_runs r where id=p_run
$$;
create function clickbooks_us.set_migration_plan(p_run uuid,p_revision int,p_plans jsonb,p_expected jsonb,p_subledger jsonb,p_evidence text,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r clickbooks_us.migration_runs%rowtype; begin
 select * into strict r from clickbooks_us.migration_runs where id=p_run for update;
 if r.state<>'staged' or r.revision is distinct from p_revision then raise exception 'CB_MIGRATION_REVISION_CONFLICT'; end if;
 if jsonb_typeof(p_plans) is distinct from 'array' or jsonb_array_length(p_plans) not between 1 and 200 or jsonb_typeof(p_expected) is distinct from 'array' or jsonb_array_length(p_expected) not between 1 and 500 or jsonb_typeof(p_subledger) is distinct from 'array' or jsonb_array_length(p_subledger)>10000 or octet_length(p_plans::text||p_expected::text||p_subledger::text)>1048576 then raise exception 'CB_INVALID_MANIFEST'; end if;
 if p_evidence is null or length(trim(p_evidence)) not between 10 and 2000 then raise exception 'CB_EXTERNAL_EVIDENCE_REQUIRED'; end if;
 update clickbooks_us.migration_runs set plans=p_plans,expected_balances=p_expected,opening_subledger=p_subledger,evidence=trim(p_evidence),revision=revision+1 where id=p_run;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('migration_plan_saved',p_run,p_actor,jsonb_build_object('revision',r.revision+1));
end $$;
create function clickbooks_us.validate_migration(p_run uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r clickbooks_us.migration_runs%rowtype; b clickbooks_us.books%rowtype; e jsonb; l jsonb; src jsonb; bank jsonb; inv jsonb; amt bigint; d bigint; c bigint; td numeric; tc numeric; ar uuid; ap uuid; bank_gl uuid; typ text; aid uuid; n int:=0; ac clickbooks_us.accounts%rowtype; proposal jsonb;
begin
 select * into strict r from clickbooks_us.migration_runs where id=p_run; select * into strict b from clickbooks_us.books where id=r.book_id;
 if r.state not in ('staged','approved') then raise exception 'CB_MIGRATION_STATE'; end if;
 if md5(clickbooks_us.source_snapshot(r.cutoff)::text)<>r.snapshot_hash then raise exception 'CB_SOURCE_CHANGED_RESTAGE'; end if;
 if jsonb_array_length(r.plans)=0 or length(trim(r.evidence))<10 or r.evidence is null then raise exception 'CB_MANIFEST_REQUIRED'; end if;
 select id into strict ar from clickbooks_us.accounts where book_id=b.id and code='1100'; select id into strict ap from clickbooks_us.accounts where book_id=b.id and code='2000';
 if exists(select 1 from jsonb_array_elements(r.plans) x group by x->>'source_kind',x->>'source_id' having count(*)>1) then raise exception 'CB_DUPLICATE_MANIFEST_SOURCE'; end if;
 if r.strategy='opening_balance' and (jsonb_array_length(r.plans)<>1 or exists(select 1 from clickbooks_us.journals where book_id=b.id) or b.opening_cutoff is not null) then raise exception 'CB_OPENING_REQUIRES_EMPTY_BOOK'; end if;
 for e in select value from jsonb_array_elements(r.plans) loop
 n:=n+1;
 if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e) k where k not in ('source_kind','source_id','date','description','lines')) or coalesce(e->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((e->>'date')::date) or (e->>'date')::date>r.cutoff or length(trim(coalesce(e->>'description',''))) not between 1 and 2000 then raise exception 'CB_INVALID_ENTRY'; end if;
 typ:=e->>'source_kind'; if typ is null or typ not in ('opening_balance','accounting_invoice','accounting_invoice_payment','bank_transaction') then raise exception 'CB_INVALID_SOURCE_KIND'; end if;
 if r.strategy='opening_balance' then
 if typ<>'opening_balance' or (e->>'date')::date<>r.cutoff or e->>'source_id' is distinct from ('opening:'||r.cutoff::text) then raise exception 'CB_INVALID_OPENING'; end if;
 elsif typ='opening_balance' then raise exception 'CB_MIXED_MIGRATION_STRATEGY'; end if;
 if length(trim(coalesce(e->>'source_id',''))) not between 1 and 200 then raise exception 'CB_INVALID_SOURCE'; end if;
 if exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind=typ and j.source_id=e->>'source_id') then raise exception 'CB_SOURCE_ALREADY_POSTED'; end if;
 if b.locked_through is not null and (e->>'date')::date<=b.locked_through then raise exception 'CB_PERIOD_LOCKED'; end if;
 if b.opening_cutoff is not null and (e->>'date')::date<=b.opening_cutoff then raise exception 'CB_PRE_CUTOFF_EVENT'; end if;
 if jsonb_typeof(e->'lines') is distinct from 'array' or jsonb_array_length(e->'lines') not between 2 and 500 then raise exception 'CB_INVALID_LINES'; end if;
 td:=0; tc:=0;
 for l in select value from jsonb_array_elements(e->'lines') loop
 if jsonb_typeof(l)<>'object' or exists(select 1 from jsonb_object_keys(l) k where k not in ('account_id','debit_cents','credit_cents','description')) then raise exception 'CB_INVALID_LINE'; end if;
 aid:=(l->>'account_id')::uuid; d:=clickbooks_us.cents(l->>'debit_cents'); c:=clickbooks_us.cents(l->>'credit_cents');
 if not((d>0 and c=0) or (c>0 and d=0)) then raise exception 'CB_INVALID_LINE_AMOUNT'; end if;
 select * into strict ac from clickbooks_us.accounts where id=aid and book_id=b.id;
 if not ac.is_active or ac.needs_review then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if; td:=td+d; tc:=tc+c;
 end loop;
 if td<>tc then raise exception 'CB_UNBALANCED'; end if;
 if typ='accounting_invoice' then
 select value into src from jsonb_array_elements(r.snapshot->'invoices') where value->>'id'=e->>'source_id';
 if src is null or src->>'currency' is distinct from 'USD' or src->>'status' is distinct from 'active' or src->>'approval' is distinct from 'approved' or src->>'date' is distinct from e->>'date' or (src->>'itemCount')::int=0 then raise exception 'CB_INVOICE_NOT_READY'; end if;
 amt:=clickbooks_us.money_cents(src->>'total');
 if amt<=0 or clickbooks_us.money_cents(src->>'itemTotal')<>amt or clickbooks_us.money_cents(src->>'paid')<>clickbooks_us.money_cents(src->>'paymentTotal') then raise exception 'CB_INVOICE_DETAIL_INCOMPLETE'; end if;
 if td<>amt or (select coalesce(sum((x->>'debit_cents')::numeric-(x->>'credit_cents')::numeric),0) from jsonb_array_elements(e->'lines')x where x->>'account_id'=ar::text)<>amt then raise exception 'CB_INVOICE_CONTROL_MISMATCH'; end if;
 if src->>'externalId' is not null and (select count(*) from jsonb_array_elements(r.snapshot->'invoices')x where x->>'externalId'=src->>'externalId')>1 then raise exception 'CB_DUPLICATE_SOURCE_ID'; end if;
 elsif typ='accounting_invoice_payment' then
 select value into src from jsonb_array_elements(r.snapshot->'payments') where value->>'id'=e->>'source_id';
 if src is null or src->>'voided' is distinct from 'false' or src->>'date' is distinct from e->>'date' then raise exception 'CB_PAYMENT_NOT_READY'; end if;
 select value into inv from jsonb_array_elements(r.snapshot->'invoices') where value->>'id'=src->>'invoiceId';
 select value into bank from jsonb_array_elements(r.snapshot->'bank') where value->>'id'=src->>'bankId';
 if inv is null or inv->>'currency' is distinct from 'USD' or inv->>'status' is distinct from 'active' or bank is null or bank->>'pending' is distinct from 'false' or bank->>'direction' is distinct from 'in' or bank->>'currency' is distinct from 'USD' then raise exception 'CB_PAYMENT_SOURCE_INVALID'; end if;
 if not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=src->>'invoiceId' and j.status='posted') and not exists(select 1 from jsonb_array_elements(r.plans)x where x->>'source_kind'='accounting_invoice' and x->>'source_id'=src->>'invoiceId') and not exists(select 1 from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id=o.run_id and mr.state='committed' where o.book_id=b.id and o.kind='receivable' and o.source_ref=src->>'invoiceId') then raise exception 'CB_PAYMENT_REQUIRES_INVOICE_OR_OPENING_ITEM'; end if;
 if exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='bank_transaction' and j.source_id=src->>'bankId') then raise exception 'CB_DUPLICATE_ECONOMIC_EVENT'; end if;
 amt:=clickbooks_us.money_cents(src->>'amount');
 if (select coalesce(sum((x->>'amount')::numeric),0) from jsonb_array_elements(r.snapshot->'payments')x where x->>'bankId'=src->>'bankId' and x->>'voided'='false')>(bank->>'amount')::numeric then raise exception 'CB_BANK_OVERALLOCATED'; end if;
 select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=bank->>'accountId' and m.reviewed and a.is_bank_sensitive and a.account_type in ('asset','liability');
 if bank_gl is null then raise exception 'CB_BANK_MAPPING_REVIEW_REQUIRED'; end if;
 if td<>amt or (select coalesce(sum((x->>'credit_cents')::numeric-(x->>'debit_cents')::numeric),0) from jsonb_array_elements(e->'lines')x where x->>'account_id'=ar::text)<>amt or (select coalesce(sum((x->>'debit_cents')::numeric-(x->>'credit_cents')::numeric),0) from jsonb_array_elements(e->'lines')x where x->>'account_id'=bank_gl::text)<>amt then raise exception 'CB_PAYMENT_CONTROL_MISMATCH'; end if;
 elsif typ='bank_transaction' then
 select value into src from jsonb_array_elements(r.snapshot->'bank') where value->>'id'=e->>'source_id';
 if src is null or src->>'currency' is distinct from 'USD' or src->>'pending' is distinct from 'false' or src->>'date' is distinct from e->>'date' or src->>'direction' not in ('in','out') then raise exception 'CB_BANK_NOT_READY'; end if;
 if src->>'hasPayment'='true' or src->>'linkedId' is not null or src->>'linkedType' is not null or src->>'matchedInvoiceId' is not null or src->>'hasSplits'='true' then raise exception 'CB_BANK_LINKED_EVIDENCE_ONLY'; end if;
 if src->>'review' not in ('approved','reviewed') then raise exception 'CB_BANK_MANUAL_REVIEW_REQUIRED'; end if;
 if src->>'externalId' is null or (select count(*) from jsonb_array_elements(r.snapshot->'bank')x where x->>'externalId'=src->>'externalId')<>1 then raise exception 'CB_DUPLICATE_SOURCE_ID'; end if;
 if (select count(*) from jsonb_array_elements(r.snapshot->'bank')x where x->>'pending'='false' and x->>'accountId'=src->>'accountId' and x->>'date'=src->>'date' and x->>'amount'=src->>'amount' and x->>'direction'=src->>'direction' and lower(coalesce(x->>'merchant',x->>'name',''))=lower(coalesce(src->>'merchant',src->>'name','')))>1 then raise exception 'CB_POSSIBLE_DUPLICATE_REVIEW'; end if;
 select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=src->>'accountId' and m.reviewed and a.is_bank_sensitive and a.account_type in ('asset','liability');
 if bank_gl is null then raise exception 'CB_BANK_MAPPING_REVIEW_REQUIRED'; end if;
 amt:=clickbooks_us.money_cents(src->>'amount');
 if td<>amt or (select coalesce(sum((x->>'debit_cents')::numeric-(x->>'credit_cents')::numeric),0) from jsonb_array_elements(e->'lines')x where x->>'account_id'=bank_gl::text)<>(case when src->>'direction'='in' then amt else -amt end) then raise exception 'CB_BANK_CONTROL_MISMATCH'; end if;
 end if;
 end loop;
 -- Expected post-batch trial balance: missing non-zero accounts, duplicate accounts and arbitrary targets fail.
 if exists(select 1 from jsonb_array_elements(r.expected_balances)x group by x->>'account_id' having count(*)>1) then raise exception 'CB_DUPLICATE_CONTROL'; end if;
 for e in select value from jsonb_array_elements(r.expected_balances) loop
 if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e)k where k not in ('account_id','net_debit_cents')) or not exists(select 1 from clickbooks_us.accounts where id=(e->>'account_id')::uuid and book_id=b.id) then raise exception 'CB_INVALID_CONTROL'; end if;
 perform clickbooks_us.cents(e->>'net_debit_cents',true);
 end loop;
 if exists(with delta as(select (l->>'account_id')::uuid aid,sum((l->>'debit_cents')::numeric-(l->>'credit_cents')::numeric) net from jsonb_array_elements(r.plans)e cross join lateral jsonb_array_elements(e->'lines')l group by 1), current_tb as(select a.id,coalesce(sum(l.debit_cents-l.credit_cents) filter(where j.status='posted' and j.entry_date<=r.cutoff),0) net from clickbooks_us.accounts a left join clickbooks_us.journal_lines l on l.account_id=a.id left join clickbooks_us.journals j on j.id=l.journal_id where a.book_id=b.id group by a.id) select 1 from current_tb c left join delta d on d.aid=c.id left join jsonb_array_elements(r.expected_balances)e on e->>'account_id'=c.id::text where c.net+coalesce(d.net,0)<>coalesce((e->>'net_debit_cents')::numeric,0)) then raise exception 'CB_RECONCILIATION_MISMATCH'; end if;
 if r.strategy='opening_balance' then
 if exists(select 1 from jsonb_array_elements(r.opening_subledger)x group by x->>'kind',x->>'source_ref' having count(*)>1) then raise exception 'CB_DUPLICATE_OPENING_ITEM'; end if;
 for e in select value from jsonb_array_elements(r.opening_subledger) loop
 if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e)k where k not in ('kind','source_ref','account_id','amount_cents')) or coalesce(e->>'kind','') not in ('receivable','payable') or length(trim(coalesce(e->>'source_ref',''))) not between 1 and 200 or e->>'account_id' is distinct from (case when e->>'kind'='receivable' then ar::text else ap::text end) or clickbooks_us.cents(e->>'amount_cents')=0 then raise exception 'CB_INVALID_OPENING_ITEM'; end if;
 if e->>'kind'='receivable' and not exists(select 1 from jsonb_array_elements(r.snapshot->'invoices')x where x->>'id'=e->>'source_ref' and x->>'currency'='USD' and x->>'status'='active') then raise exception 'CB_OPENING_RECEIVABLE_SCOPE'; end if;
 end loop;
 for e in select jsonb_build_object('id',ar,'sign',1,'kind','receivable') union all select jsonb_build_object('id',ap,'sign',-1,'kind','payable') loop
 if (select coalesce(sum((x->>'amount_cents')::numeric),0)*(e->>'sign')::int from jsonb_array_elements(r.opening_subledger)x where x->>'kind'=e->>'kind')<>(select coalesce(sum((x->>'net_debit_cents')::numeric),0) from jsonb_array_elements(r.expected_balances)x where x->>'account_id'=e->>'id') then raise exception 'CB_OPENING_SUBLEDGER_MISMATCH'; end if;
 end loop;
 elsif jsonb_array_length(r.opening_subledger)>0 then raise exception 'CB_OPENING_ITEMS_WRONG_STRATEGY'; end if;
 return jsonb_build_object('ok',true,'entries',n,'scope','KTC_US','strategy',r.strategy,'cutoff',r.cutoff,'historyReady',false,'note','Validation checks this reviewed batch, not completeness of all historical books.');
end $$;

revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
