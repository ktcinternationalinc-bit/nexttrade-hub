-- v55.83-SJ — bills on the books before they are paid (accounts payable). Run after 13_rb.sql (+ the RS and SJ SQL files).
alter table public.vendor_bills add column if not exists validation_status text, add column if not exists bill_date date, add column if not exists total_amount numeric;
create or replace function ap() returns jsonb language sql as $$ select clickbooks_us.payable_sync_run('2026-11-01','2026-11-12','00000000-0000-0000-0000-0000000000aa') $$;
create or replace function ex() returns jsonb language sql as $$ select public.clickbooks_us_ledger_extras_job('2026-11-01','2026-11-12','00000000-0000-0000-0000-0000000000aa') $$;
create or replace function apbal() returns numeric language sql as $$ select coalesce(sum(l.credit_cents - l.debit_cents),0)/100.0 from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where a.code='2000' $$;
create or replace function acct_of(k text) returns numeric language sql as $$ select coalesce(sum(l.debit_cents - l.credit_cents),0)/100.0 from clickbooks_us.journal_lines l where l.account_id = clickbooks_us.category_account((select id from clickbooks_us.books where code='KTC_US'), k) $$;
do $$ begin perform public.clickbooks_us_payables_set_start('2026-11-02','00000000-0000-0000-0000-0000000000aa'); raise notice 'P0 FAIL: accepted with no payable account'; exception when others then raise notice 'P0 no approved payable account → refused: %', SQLERRM; end $$;
insert into clickbooks_us.accounts(book_id, code, name, account_type, normal_side, origin) select id, '2000', 'Accounts payable control', 'liability', 'credit', 'control' from clickbooks_us.books where code='KTC_US' on conflict do nothing;
select 'P0 status off: start='||coalesce((public.clickbooks_us_payables_status()->>'start_date'),'null')||' ready='||(public.clickbooks_us_payables_status()->>'payable_account_ready');
insert into public.vendor_bills(id,vendor_name,category,paid_via,validation_status,bill_date,total_amount) values
 ('b1000000-0000-0000-0000-000000000001','Trinity','office_supplies',null,'validated','2026-11-03',1000),
 ('b1000000-0000-0000-0000-000000000002','Not validated','office_supplies',null,null,'2026-11-03',500),
 ('b1000000-0000-0000-0000-000000000003','Before start','office_supplies',null,'validated','2026-11-01',300),
 ('b1000000-0000-0000-0000-000000000004','Via RTM','office_supplies','RTM Capital','validated','2026-11-04',700),
 ('b1000000-0000-0000-0000-000000000005','Via NextTrade','office_supplies','NextTrade Industries','validated','2026-11-04',400);
begin isolation level repeatable read; select 'P1 OFF → nothing: '||ap()::text; commit;
select 'P1 AP='||apbal();
do $$ begin perform public.clickbooks_us_payables_set_start('2026-10-31','00000000-0000-0000-0000-0000000000aa'); raise notice 'P2 FAIL: start on the opening date was accepted'; exception when others then raise notice 'P2 start on/before the opening balance refused: %', SQLERRM; end $$;
select 'P2 set: '||public.clickbooks_us_payables_set_start('2026-11-02','00000000-0000-0000-0000-0000000000aa')::text;
select 'P3 exp before='||acct_of('office_supplies');
begin isolation level repeatable read; select 'P3 run: billsOnBooks='||(ap()->>'billsOnBooks'); commit;
select 'P3 AP='||apbal()||' (want 1400: Trinity 1000 + NextTrade 400; not validated / before start / RTM left out)';
begin isolation level repeatable read; select 'P3 again (no-op): billsOnBooks='||(ap()->>'billsOnBooks')||' reversed='||(ap()->>'reversed'); commit;
-- pay Trinity from the bank: payment exists but the bank line is not in the ledger yet → waiting
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,date,amount_abs,direction) values
 ('c1000000-0000-0000-0000-000000000001','WB1','ACC1','reviewed','office_supplies','2026-11-06',1000,'out');
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('a2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',1000,'2026-11-06','c1000000-0000-0000-0000-000000000001','wire');
begin isolation level repeatable read; select 'P4 before the bank line posts: '||(ap()->'waiting')::text||' cleared='||(ap()->>'paymentsCleared'); commit;
select 'P4 AP still='||apbal();
begin isolation level repeatable read; select 'P5 bank line posts: '||(cls()->>'classifiedPosted'); commit;
begin isolation level repeatable read; select 'P5 run: paymentsCleared='||(ap()->>'paymentsCleared'); commit;
select 'P5 AP='||apbal()||' (want 400)  bank 1010 moved by the payment only';
-- NextTrade pays its bill for us (related-company entry), then the debt clears
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('a2000000-0000-0000-0000-000000000005','b1000000-0000-0000-0000-000000000005',400,'2026-11-07',null,'rtm');
begin isolation level repeatable read; select 'P6 whole job: '||(ex()->'payables')::text; commit;
select 'P6 AP='||apbal()||' (want 0)';
-- cost counted ONCE: 1000 + 400 from this file's two bills on the books
select 'P7 cost of these bills in the ledger (office_supplies, change since P3 start)='||acct_of('office_supplies');
-- the RTM bill: its payment never creates a payable entry
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('a2000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000004',700,'2026-11-07',null,'rtm');
begin isolation level repeatable read; select 'P8 RTM: cleared='||(ap()->>'paymentsCleared')||' onBooks='||(ap()->>'billsOnBooks'); commit;
-- the bill amount changes → reversed and re-posted; payment entry stays right
update public.vendor_bills set total_amount = 1200 where id='b1000000-0000-0000-0000-000000000001';
begin isolation level repeatable read; select 'P9 amount changed: '||ap()::text; commit;
begin isolation level repeatable read; select 'P9 settle: '||ap()::text; commit;
select 'P9 AP='||apbal()||' (want 200: 1200 billed − 1000 paid)';
-- un-validate → off the books (bill + its payment entry), same run
update public.vendor_bills set validation_status = null where id='b1000000-0000-0000-0000-000000000001';
begin isolation level repeatable read; select 'P10 un-validated: reversed='||(ap()->>'reversed'); commit;
select 'P10 AP='||apbal()||' (want 0)';
-- switch OFF → everything this job made is reversed
update public.vendor_bills set validation_status = 'validated', total_amount = 1000 where id='b1000000-0000-0000-0000-000000000001';
begin isolation level repeatable read; select 'P11 back on: '||(ap()->>'billsOnBooks'); commit;
begin isolation level repeatable read; select 'P11 pay clears: '||(ap()->>'paymentsCleared'); commit;
select 'P11 AP='||apbal();
select 'P12 off: '||public.clickbooks_us_payables_set_start(null,'00000000-0000-0000-0000-0000000000aa')::text;
begin isolation level repeatable read; select 'P12 run: '||ap()::text; commit;
select 'P12 live payable entries='||(select count(*) from clickbooks_us.journals j where (j.source_id like 'apbill:%' or j.source_id like 'appay:%') and not exists(select 1 from clickbooks_us.journals r where r.reverses_id=j.id))||' AP='||apbal();
select 'P13 status: '||public.clickbooks_us_payables_status()::text;
select 'TRIAL BALANCE nets to zero: '||(select sum(debit_cents-credit_cents) from clickbooks_us.journal_lines);
