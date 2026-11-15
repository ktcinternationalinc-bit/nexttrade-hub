-- v55.83-SO scenarios: a confirmed duplicate leaves the books, the ledger follows, restore brings it back.
\set actor '''00000000-0000-0000-0000-0000000000aa'''
alter table public.bank_transactions add column if not exists plaid_transaction_id text, add column if not exists name text, add column if not exists amount numeric;
create table if not exists public.wire_packages(id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, status text);
update clickbooks_us.books set locked_through = null where code = 'KTC_US';
\i ../../../sql/v55-83-SO-duplicates.sql
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,date,amount_abs,direction,plaid_transaction_id,name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','WB1','ACC1','reviewed','office','2026-11-05',250,'out','plaid-K','ACME SUPPLY'),
 ('aaaaaaaa-0000-0000-0000-000000000002','WB1','ACC1','reviewed','office','2026-11-05',250,'out','plaid-D','ACME SUPPLY'),
 ('aaaaaaaa-0000-0000-0000-000000000003','WB1','ACC1','unreviewed',null,'2026-11-05',999,'out','plaid-X','OTHER'),
 ('aaaaaaaa-0000-0000-0000-000000000004','WB1','ACC1','unreviewed',null,'2026-11-05',250,'in','plaid-IN','ACME REFUND');
select 'T0 office before='||bal('6000')||' bank='||bal('1010');
begin isolation level repeatable read; select 'T1 both posted: '||(cls()->>'classifiedPosted'); commit;
select 'T1 office='||bal('6000')||' bank='||bal('1010');
select 'T2 different amount: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001',:actor,'x')->>'why');
select 'T3 opposite direction: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001',:actor,'x')->>'why');
select 'T4 same row: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',:actor,'x')->>'why');
update public.bank_transactions set matched_invoice_id = gen_random_uuid() where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'T5 matched: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',:actor,'x')->>'blocked_by');
update public.bank_transactions set matched_invoice_id = null, transfer_group_id = gen_random_uuid() where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'T6 transfer leg: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',:actor,'x')->>'blocked_by');
update public.bank_transactions set transfer_group_id = null where id='aaaaaaaa-0000-0000-0000-000000000002';
insert into public.wire_packages(bank_transaction_id,status) values ('aaaaaaaa-0000-0000-0000-000000000002','attached');
select 'T7 wire: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',:actor,'x')->>'blocked_by');
delete from public.wire_packages;
update clickbooks_us.books set locked_through = date '2026-11-30' where code='KTC_US';
select 'T8 closed month: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',:actor,'x')->>'blocked_by');
update clickbooks_us.books set locked_through = null where code='KTC_US';
select 'T8b still in books: '||(select count(*) from public.bank_transactions where id='aaaaaaaa-0000-0000-0000-000000000002');
select 'T9 remove: '||public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',:actor,'same line twice')::text;
select 'T9 in books='||(select count(*) from public.bank_transactions where id='aaaaaaaa-0000-0000-0000-000000000002')||' archived='||(select count(*) from public.bank_transaction_duplicates where id='aaaaaaaa-0000-0000-0000-000000000002' and status='removed')||' name kept='||(select row_data->>'name' from public.bank_transaction_duplicates where id='aaaaaaaa-0000-0000-0000-000000000002');
begin isolation level repeatable read; select 'T10 ledger follows: reversed='||(drift()->>'reversedBank'); commit;
select 'T10 office='||bal('6000')||' bank='||bal('1010');
begin isolation level repeatable read; select 'T10b nothing re-posted: '||(cls()->>'classifiedPosted'); commit;
insert into public.bank_transactions(id,wave_business_id,account_id,date,amount_abs,direction,plaid_transaction_id,name) values (gen_random_uuid(),'WB1','ACC1','2026-11-05',250,'out','plaid-D','ACME SUPPLY');
select 'T11 bank sends it again: rows with that bank id='||(select count(*) from public.bank_transactions where plaid_transaction_id='plaid-D');
insert into public.bank_transactions(id,wave_business_id,account_id,date,amount_abs,direction,plaid_transaction_id,name) values (gen_random_uuid(),'WB1','ACC1','2026-11-06',75,'out','plaid-NEW','NEW LINE');
select 'T11b other new lines still arrive='||(select count(*) from public.bank_transactions where plaid_transaction_id='plaid-NEW');
select 'T12 remove again: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000002',null,:actor,'x')->>'why');
do $$ begin delete from public.bank_transaction_duplicates; raise notice 'T13 FAIL: record erased'; exception when others then raise notice 'T13 erase refused: %', sqlerrm; end $$;
do $$ begin update public.bank_transaction_duplicates set row_data = '{}'::jsonb; raise notice 'T14 FAIL: record rewritten'; exception when others then raise notice 'T14 rewrite refused: %', sqlerrm; end $$;
select 'T15 restore: '||public.bank_duplicate_restore('aaaaaaaa-0000-0000-0000-000000000002',:actor)::text;
select 'T15 back in books='||(select count(*) from public.bank_transactions where id='aaaaaaaa-0000-0000-0000-000000000002' and name='ACME SUPPLY' and classification='office' and review_status='reviewed' and amount_abs=250)||' record kept as history='||(select count(*) from public.bank_transaction_duplicates where id='aaaaaaaa-0000-0000-0000-000000000002' and status='restored');
begin isolation level repeatable read; select 'T16 ledger re-posts: '||(cls()->>'classifiedPosted'); commit;
select 'T16 office='||bal('6000')||' bank='||bal('1010');
select 'T17 restore twice: '||(public.bank_duplicate_restore('aaaaaaaa-0000-0000-0000-000000000002',:actor)->>'why');
select 'T18 remove a second time: '||(public.bank_duplicate_remove('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',:actor,'again')->>'ok')||' records for it='||(select count(*) from public.bank_transaction_duplicates where id='aaaaaaaa-0000-0000-0000-000000000002');
begin isolation level repeatable read; select 'T18 reversed='||(drift()->>'reversedBank'); commit;
select 'T18 office='||bal('6000')||' bank='||bal('1010');
select 'T19 trial balance nets to '||(select coalesce(sum(l.debit_cents-l.credit_cents),0) from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id=l.journal_id where j.status='posted');
select 'T20 re-run of the SQL file is safe:';
\i ../../../sql/v55-83-SO-duplicates.sql
select 'T20 records after re-run='||(select count(*) from public.bank_transaction_duplicates);
