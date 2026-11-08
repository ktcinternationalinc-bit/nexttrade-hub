\set actor '''00000000-0000-0000-0000-0000000000aa'''
create or replace function public.bal(code text) returns bigint language sql as $$
 select coalesce(sum(l.debit_cents-l.credit_cents),0)::bigint from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id join clickbooks_us.journals j on j.id=l.journal_id where a.code=$1 and j.status='posted' $$;
create or replace function public.bal_name(n text) returns bigint language sql as $$
 select coalesce(sum(l.debit_cents-l.credit_cents),0)::bigint from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id join clickbooks_us.journals j on j.id=l.journal_id where a.name=$1 and j.status='posted' $$;
create or replace function public.cls() returns jsonb language plpgsql as $$ begin return clickbooks_us.classified_sync_run(date '2026-11-01', date '2026-11-08', '00000000-0000-0000-0000-0000000000aa'); end $$;
create or replace function public.drift() returns jsonb language plpgsql as $$ begin return clickbooks_us.drift_sync_run('00000000-0000-0000-0000-0000000000aa'); end $$;
-- S2 first: 1090 unapproved must NOT abort the run
update clickbooks_us.accounts set needs_review=true where code='1090';
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,transfer_group_id,date,amount_abs,direction) values
 ('11111111-1111-1111-1111-111111111111','WB1','ACC1','reviewed','transfer','99999999-9999-9999-9999-999999999999','2026-11-03',500,'out'),
 ('22222222-2222-2222-2222-222222222222','WB1','ACC2','reviewed','transfer','99999999-9999-9999-9999-999999999999','2026-11-03',500,'in'),
 ('33333333-3333-3333-3333-333333333333','WB1','ACC1','reviewed','office',null,'2026-11-04',100,'out');
begin isolation level repeatable read; select 'S2 unapproved 1090: '||(cls()->>'skippedTransfers')||' skipped, posted='||(cls()->>'classifiedPosted'); commit;
update clickbooks_us.accounts set needs_review=false where code='1090';
begin isolation level repeatable read; select 'S1 transfers: '||cls()::text; commit;
select 'S1 balances 1010='||bal('1010')||' 1020='||bal('1020')||' 1090='||bal('1090')||' 6000='||bal('6000');
-- S3 recategorize office -> rent
update public.bank_transactions set classification='rent' where id='33333333-3333-3333-3333-333333333333';
begin isolation level repeatable read; select 'S3 drift: '||drift()::text; commit;
begin isolation level repeatable read; select 'S3 repost: '||(cls()->>'classifiedPosted'); commit;
select 'S3 balances 6000='||bal('6000')||' 6100='||bal('6100')||' 1010='||bal('1010');
-- S4 recategorize rent -> meals (no ledger account yet)
update public.bank_transactions set classification='meals' where id='33333333-3333-3333-3333-333333333333';
begin isolation level repeatable read; select 'S4 drift: '||(drift()->>'reversedBank'); commit;
begin isolation level repeatable read; select 'S4 repost: '||cls()::text; commit;
select 'S4 balances 6100='||bal('6100')||' meals='||bal_name('Meals and entertainment')||' 1010='||bal('1010');
-- S9 idempotent
begin isolation level repeatable read; select 'S9 drift again: '||drift()::text; commit;
begin isolation level repeatable read; select 'S9 cls again posted='||(cls()->>'classifiedPosted')||' already='||(cls()->>'alreadyPosted'); commit;
-- S5 duplicate
update public.bank_transactions set review_status='duplicate' where id='33333333-3333-3333-3333-333333333333';
begin isolation level repeatable read; select 'S5 drift: '||(drift()->>'reversedBank'); commit;
begin isolation level repeatable read; select 'S5 cls posted='||(cls()->>'classifiedPosted'); commit;
select 'S5 balances meals='||bal_name('Meals and entertainment')||' 1010='||bal('1010');
-- S10 unpair one transfer leg and give it a category -> reverse + repost as expense
update public.bank_transactions set transfer_group_id=null, classification='office' where id='11111111-1111-1111-1111-111111111111';
begin isolation level repeatable read; select 'S10 drift: '||(drift()->>'reversedBank'); commit;
begin isolation level repeatable read; select 'S10 cls: '||(cls()->>'classifiedPosted'); commit;
select 'S10 balances 1090='||bal('1090')||' 6000='||bal('6000')||' 1010='||bal('1010');
