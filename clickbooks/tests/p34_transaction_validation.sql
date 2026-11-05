-- READ existing US sources; write only private QA fixtures, then roll back EVERYTHING.
-- This validates source-backed drafts; it does not migrate real financial entries.
begin isolation level repeatable read;
do $$
declare book_uuid uuid; ar_uuid uuid; bank_uuid uuid; income_uuid uuid; expense_uuid uuid;
 actor_uuid uuid:=gen_random_uuid(); run_uuid uuid; inv jsonb; bank_row jsonb; source_data jsonb;
 entry jsonb; expected jsonb; amount_cent bigint; cp_uuid uuid; source_before jsonb; passed jsonb:='[]';
begin
 select id into strict book_uuid from clickbooks_us.books where code='KTC_US';
 source_before:=clickbooks_us.audit_source()->'source_digests';
 select id into strict ar_uuid from clickbooks_us.accounts where book_id=book_uuid and code='1100';
 insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,is_bank_sensitive,origin) values(book_uuid,'QA-P34-TXBANK','QA Bank','asset','debit',true,'manual') returning id into bank_uuid;
 insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,origin) values(book_uuid,'QA-P34-TXINCOME','QA Income','income','credit','manual') returning id into income_uuid;
 insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,origin) values(book_uuid,'QA-P34-TXEXPENSE','QA Expense','expense','debit','manual') returning id into expense_uuid;
 source_data:=clickbooks_us.source_snapshot(current_date);
 select value into strict inv from jsonb_array_elements(source_data->'invoices') where value->>'currency'='USD' and value->>'approval'='approved' and value->>'status'='active' and (value->>'paid')::numeric=0 and (value->>'paymentTotal')::numeric=0 and (value->>'total')::numeric>0 and (value->>'itemTotal')::numeric=(value->>'total')::numeric limit 1;
 amount_cent:=clickbooks_us.money_cents(inv->>'total');
 entry:=jsonb_build_object('source_kind','accounting_invoice','source_id',inv->>'id','date',inv->>'date','description','QA VALIDATION ONLY; DO NOT POST','lines',jsonb_build_array(jsonb_build_object('account_id',ar_uuid,'debit_cents',amount_cent::text,'credit_cents','0'),jsonb_build_object('account_id',income_uuid,'debit_cents','0','credit_cents',amount_cent::text)));
 expected:=jsonb_build_array(jsonb_build_object('account_id',ar_uuid,'net_debit_cents',amount_cent::text),jsonb_build_object('account_id',income_uuid,'net_debit_cents',(-amount_cent)::text));
 run_uuid:=clickbooks_us.create_migration_run(gen_random_uuid(),current_date,'transaction_batch',actor_uuid);
 perform clickbooks_us.set_migration_plan(run_uuid,1,jsonb_build_array(entry),expected,'[]','QA synthetic expected controls, NOT a real independent reconciliation',actor_uuid);
 if clickbooks_us.validate_migration(run_uuid)->>'ok'<>'true' then raise exception 'QA_INVOICE_VALIDATION'; end if; passed:=passed||'"source-backed approved unpaid USD invoice draft validates"'::jsonb;
 select value into strict bank_row from jsonb_array_elements(source_data->'bank') where value->>'currency'='USD' and value->>'pending'='false' and value->>'review' in ('approved','reviewed') and value->>'hasPayment'='false' and value->>'hasSplits'='false' and value->>'linkedId' is null and value->>'linkedType' is null and value->>'matchedInvoiceId' is null and coalesce(value->>'classification','') not in ('customer_payment','vendor_payment','transfer') limit 1;
 amount_cent:=clickbooks_us.money_cents(bank_row->>'amount');
 cp_uuid:=case when bank_row->>'direction'='in' then income_uuid else expense_uuid end;
 entry:=jsonb_build_object('source_kind','bank_transaction','source_id',bank_row->>'id','date',bank_row->>'date','description','QA VALIDATION ONLY; DO NOT POST','lines',jsonb_build_array(jsonb_build_object('account_id',bank_uuid,'debit_cents',case when bank_row->>'direction'='in' then amount_cent::text else '0' end,'credit_cents',case when bank_row->>'direction'='out' then amount_cent::text else '0' end),jsonb_build_object('account_id',cp_uuid,'debit_cents',case when bank_row->>'direction'='out' then amount_cent::text else '0' end,'credit_cents',case when bank_row->>'direction'='in' then amount_cent::text else '0' end)));
 expected:=jsonb_build_array(jsonb_build_object('account_id',bank_uuid,'net_debit_cents',(case when bank_row->>'direction'='in' then amount_cent else -amount_cent end)::text),jsonb_build_object('account_id',cp_uuid,'net_debit_cents',(case when bank_row->>'direction'='out' then amount_cent else -amount_cent end)::text));
 run_uuid:=clickbooks_us.create_migration_run(gen_random_uuid(),current_date,'transaction_batch',actor_uuid);
 perform clickbooks_us.set_migration_plan(run_uuid,1,jsonb_build_array(entry),expected,'[]','QA synthetic controls only, not independent bank-statement evidence',actor_uuid);
 begin perform clickbooks_us.validate_migration(run_uuid); raise exception 'QA_EXPECTED_MAPPING_REJECTION'; exception when others then if SQLERRM not like 'CB_BANK_MAPPING_REVIEW_REQUIRED%' then raise; end if; end; passed:=passed||'"standalone bank draft blocked without reviewed bank mapping"'::jsonb;
 insert into clickbooks_us.bank_ledger_map(book_id,provider_account_id,account_id,reviewed,evidence) values(book_uuid,bank_row->>'accountId',bank_uuid,true,'QA rollback-only synthetic account mapping');
 if clickbooks_us.validate_migration(run_uuid)->>'ok'<>'true' then raise exception 'QA_BANK_VALIDATION'; end if; passed:=passed||'"source-backed reviewed standalone bank draft validates"'::jsonb;
 perform clickbooks_us.set_migration_plan(run_uuid,2,jsonb_build_array(entry,entry),expected,'[]','QA duplicate manifest failure fixture',actor_uuid);
 begin perform clickbooks_us.validate_migration(run_uuid); raise exception 'QA_EXPECTED_DUPLICATE_REJECTION'; exception when others then if SQLERRM not like 'CB_DUPLICATE_MANIFEST_SOURCE%' then raise; end if; end; passed:=passed||'"duplicate source within transaction manifest rejected"'::jsonb;
 if exists(select 1 from clickbooks_us.journals) or source_before<>clickbooks_us.audit_source()->'source_digests' then raise exception 'QA_SOURCE_CHANGED'; end if; passed:=passed||'"validation creates no journals and leaves legacy sources unchanged"'::jsonb;
 perform set_config('clickbooks.p34_transaction_qa',jsonb_build_object('passed',jsonb_array_length(passed),'tests',passed,'fixtures','All private QA objects rolled back; real source records only read')::text,true);
end $$;
select current_setting('clickbooks.p34_transaction_qa')::jsonb as transaction_validation_qa;
rollback;
