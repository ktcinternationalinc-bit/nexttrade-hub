-- Minimal, exact-US snapshots. No token, raw bank payload, Egypt, Treasury or Sales access.
create function clickbooks_us.source_snapshot(p_cutoff date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare src text; v jsonb;
begin
 if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff>current_date then raise exception 'CB_INVALID_CUTOFF'; end if;
 select wave_business_id into strict src from clickbooks_us.books where code='KTC_US';
 with i as (select * from public.accounting_invoices where wave_business_id=src and (invoice_date<=p_cutoff or invoice_date is null)),
 p as (select * from public.accounting_invoice_payments where wave_business_id=src and (payment_date<=p_cutoff or payment_date is null)),
 t as (select * from public.bank_transactions where wave_business_id=src and (coalesce(posted_date,date)<=p_cutoff or coalesce(posted_date,date) is null)),
 ip as (select accounting_invoice_id,sum(amount) amount,count(*) n from p where voided is not true group by accounting_invoice_id),
 il as (select l.invoice_id,count(*) n,sum(l.line_total) amount,md5(jsonb_agg(jsonb_build_object('id',l.id,'description',l.description,'quantity',l.quantity::text,'unitPrice',l.unit_price::text,'lineTotal',l.line_total::text,'product',l.wave_product_id) order by l.id)::text) hash
 from public.accounting_invoice_items l join i on i.id=l.invoice_id where l.wave_business_id=src group by l.invoice_id)
 select jsonb_build_object('book','KTC_US','currency','USD','cutoff',p_cutoff,
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'externalId',i.wave_invoice_id,'number',i.invoice_number,'date',i.invoice_date,'currency',i.currency,'status',i.record_status,'approval',i.approval_status,'total',i.total_amount::text,'paid',i.amount_paid::text,'balance',i.balance_due::text,'wavePaid',i.wave_imported_paid::text,'customerId',i.accounting_customer_id,'itemCount',coalesce(il.n,0),'itemTotal',il.amount::text,'itemsHash',il.hash,'paymentCount',coalesce(ip.n,0),'paymentTotal',coalesce(ip.amount,0)::text) order by i.id) from i left join ip on ip.accounting_invoice_id=i.id left join il on il.invoice_id=i.id),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'invoiceId',accounting_invoice_id,'date',payment_date,'amount',amount::text,'bankId',bank_transaction_id,'externalId',wave_payment_id,'voided',coalesce(voided,false)) order by id) from p),'[]'::jsonb),
 'bank',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'externalId',plaid_transaction_id,'date',coalesce(posted_date,date),'currency',iso_currency,'amount',amount_abs::text,'direction',direction,'pending',pending,'review',review_status,'classification',classification,'name',name,'merchant',merchant_name,'accountId',account_id,'linkedType',linked_type,'linkedId',linked_id,'matchedInvoiceId',matched_invoice_id,'waveAccountId',wave_account_id,'hasSplits',exists(select 1 from public.bank_transaction_splits s where s.bank_transaction_id=t.id and s.wave_business_id=src),'hasPayment',exists(select 1 from public.accounting_invoice_payments p2 where p2.bank_transaction_id=t.id and p2.wave_business_id=src and p2.voided is not true)) order by t.id) from t),'[]'::jsonb),
 'accountMapHash',(select md5(coalesce(jsonb_agg(jsonb_build_object('source',source_account_id,'target',account_id,'reviewed',reviewed) order by source_account_id)::text,'')) from clickbooks_us.source_account_map m join clickbooks_us.books b on b.id=m.book_id where b.code='KTC_US')) into v;
 return v;
end $$;
create function clickbooks_us.migration_report(s jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
with i as(select value v from jsonb_array_elements(s->'invoices')),
p as(select value v from jsonb_array_elements(s->'payments')),
t as(select value v from jsonb_array_elements(s->'bank'))
select jsonb_build_object('counts',jsonb_build_object('invoices',(select count(*) from i),'payments',(select count(*) from p),'bank',(select count(*) from t)),
'issues',jsonb_build_object(
'non_usd_invoices',(select count(*) from i where v->>'currency' is distinct from 'USD'),
'nonapproved_invoices',(select count(*) from i where v->>'currency'='USD' and v->>'approval' is distinct from 'approved'),
'missing_invoice_items',(select count(*) from i where v->>'currency'='USD' and (v->>'itemCount')::int=0),
'incomplete_payment_history',(select count(*) from i where v->>'currency'='USD' and coalesce((v->>'paid')::numeric,0)<>coalesce((v->>'paymentTotal')::numeric,0)),
'duplicate_wave_invoice_ids',(select count(*) from(select v->>'externalId' from i where v->>'externalId' is not null group by 1 having count(*)>1)x),
'duplicate_bank_ids',(select count(*) from(select v->>'externalId' from t where v->>'externalId' is not null group by 1 having count(*)>1)x),
'possible_duplicate_bank_events',(select count(*) from(select v->>'accountId',v->>'date',v->>'amount',v->>'direction',lower(coalesce(v->>'merchant',v->>'name','')) from t where v->>'pending'='false' group by 1,2,3,4,5 having count(*)>1)x),
'pending_bank',(select count(*) from t where v->>'pending' is distinct from 'false'),
'bank_linked_payment_evidence_only',(select count(*) from t where v->>'hasPayment'='true'),
'unreviewed_bank',(select count(*) from t where v->>'review'='unreviewed')),
'limitations','Current invoice paid/balance fields are not historical as-of balances. Possible duplicates are review candidates, never auto-deleted. A staged snapshot is not a reconciled ledger.')
$$;
create function clickbooks_us.create_migration_run(p_key uuid,p_cutoff date,p_strategy text,p_actor uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r clickbooks_us.migration_runs%rowtype; s jsonb; b uuid;
begin
 if p_key is null or p_strategy not in ('transaction_batch','opening_balance') or p_strategy is null then raise exception 'CB_INVALID_MIGRATION_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into r from clickbooks_us.migration_runs where request_key=p_key;
 if found then if r.cutoff=p_cutoff and r.strategy=p_strategy then return r.id; else raise exception 'CB_IDEMPOTENCY_CONFLICT'; end if; end if;
 select id into strict b from clickbooks_us.books where code='KTC_US'; s:=clickbooks_us.source_snapshot(p_cutoff);
 insert into clickbooks_us.migration_runs(request_key,book_id,cutoff,strategy,snapshot,snapshot_hash,created_by) values(p_key,b,p_cutoff,p_strategy,s,md5(s::text),p_actor) returning * into r;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('migration_snapshot',r.id,p_actor,clickbooks_us.migration_report(s));
 return r.id;
end $$;
-- Refuse mutation of evidence after approval; adjustments require a new run.
create function clickbooks_us.guard_migration_run() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if TG_OP='DELETE' then raise exception 'CB_MIGRATION_EVIDENCE_IMMUTABLE'; end if;
 if (NEW.id,NEW.request_key,NEW.book_id,NEW.cutoff,NEW.strategy,NEW.snapshot,NEW.snapshot_hash,NEW.created_by,NEW.created_at)
 is distinct from (OLD.id,OLD.request_key,OLD.book_id,OLD.cutoff,OLD.strategy,OLD.snapshot,OLD.snapshot_hash,OLD.created_by,OLD.created_at) then raise exception 'CB_MIGRATION_EVIDENCE_IMMUTABLE'; end if;
 if OLD.state<>'staged' and (NEW.plans,NEW.expected_balances,NEW.opening_subledger,NEW.evidence,NEW.approval_hash)
 is distinct from (OLD.plans,OLD.expected_balances,OLD.opening_subledger,OLD.evidence,OLD.approval_hash) then raise exception 'CB_MIGRATION_PLAN_LOCKED'; end if;
 if NEW.state<>OLD.state and not ((OLD.state='staged' and NEW.state='approved') or (OLD.state='approved' and NEW.state='committed') or (OLD.state='committed' and NEW.state='reversed')) then raise exception 'CB_MIGRATION_STATE'; end if;
 return NEW;
end $$;
create trigger cb_migration_run_guard before update or delete on clickbooks_us.migration_runs for each row execute function clickbooks_us.guard_migration_run();
revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
