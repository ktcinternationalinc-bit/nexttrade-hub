create function clickbooks_us.audit_source() returns jsonb language sql stable security invoker set search_path='' as $$
with b as(select wave_business_id src from clickbooks_us.books where code='KTC_US'),
i as(select * from public.accounting_invoices where wave_business_id=(select src from b)),
p as(select * from public.accounting_invoice_payments where wave_business_id=(select src from b)),
t as(select * from public.bank_transactions where wave_business_id=(select src from b)),
w as(select * from public.wave_categories where wave_business_id=(select src from b))
select jsonb_build_object(
 'scope','KTC_US_ACCOUNTING_ONLY','checked_at',now(),
 'counts',jsonb_build_object('usd_invoices',(select count(*) from i where currency='USD'),'foreign_currency_invoices',(select count(*) from i where currency is distinct from 'USD'),'customers',(select count(*) from public.accounting_customers where wave_business_id=(select src from b)),'active_payment_rows',(select count(*) from p where voided is not true),'void_payment_rows',(select count(*) from p where voided is true),'bank_rows',(select count(*) from t),'pending_bank_rows',(select count(*) from t where pending),'source_accounts',(select count(*) from w)),
 'checks',jsonb_build_object(
 'duplicate_wave_invoice_ids',(select count(*) from(select wave_invoice_id from i where wave_invoice_id is not null group by wave_invoice_id having count(*)>1)x),
 'duplicate_bank_source_ids',(select count(*) from(select plaid_transaction_id from t where plaid_transaction_id is not null group by plaid_transaction_id having count(*)>1)x),
 'invoice_arithmetic_mismatches',(select count(*) from i where abs(total_amount-amount_paid-balance_due)>0.01),
 'missing_invoice_items',(select count(*) from i where currency='USD' and not exists(select 1 from public.accounting_invoice_items l where l.invoice_id=i.id)),
 'payment_missing_us_invoice',(select count(*) from p where voided is not true and not exists(select 1 from i where i.id=p.accounting_invoice_id)),
 'payment_missing_us_bank_row',(select count(*) from p where voided is not true and bank_transaction_id is not null and not exists(select 1 from t where t.id=p.bank_transaction_id)),
 'historical_paid_without_local_payment_rows',(select count(*) from i where coalesce(wave_imported_paid,0)>0 and not exists(select 1 from p where p.accounting_invoice_id=i.id and p.voided is not true)),
 'unreviewed_bank_rows',(select count(*) from t where review_status='unreviewed'),
 'bank_missing_legacy_business_uuid',(select count(*) from t where business_id is null),
 'bank_missing_wave_account_mapping',(select count(*) from t where wave_account_id is null),
 'us_scheduled_sync_log_rows',(select count(*) from public.wave_sync_log where wave_business_id=(select src from b) and action in ('scheduled_pull','scheduled_sync'))),
 'quarantined_invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'invoice_number',invoice_number,'currency',currency,'reason','Currency is not USD; do not infer subsidiary or FX rate')) from i where currency is distinct from 'USD'),'[]'::jsonb),
 'missing_item_invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'invoice_number',invoice_number)) from i where currency='USD' and not exists(select 1 from public.accounting_invoice_items l where l.invoice_id=i.id)),'[]'::jsonb),
 'active_bank_connection_sync',coalesce((select jsonb_agg(jsonb_build_object('connection_id',id,'status',status,'last_sync_status',last_sync_status,'last_synced',last_synced,'last_successful_plaid_sync_at',last_successful_plaid_sync_at,'last_successful_posted_date',last_successful_posted_date)) from public.bank_connections where wave_business_id=(select src from b) and status='active'),'[]'::jsonb),
 'source_digests',jsonb_build_object('accounting_invoices',(select md5(coalesce(string_agg(to_jsonb(i)::text,'|' order by id),'')) from i),'invoice_payments',(select md5(coalesce(string_agg(to_jsonb(p)::text,'|' order by id),'')) from p),'bank_transactions',(select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from t),'wave_categories',(select md5(coalesce(string_agg(to_jsonb(w)::text,'|' order by id),'')) from w)),
 'verification_limit','Hub database and supplied source inspected. No live Wave/Plaid provider request, production frontend inspection, or complete historical GL reconciliation performed.'
)
$$;
revoke all on function clickbooks_us.audit_source() from public,anon,authenticated,service_role;
insert into clickbooks_us.audit_runs(book_id,findings) select id,clickbooks_us.audit_source() from clickbooks_us.books where code='KTC_US';
