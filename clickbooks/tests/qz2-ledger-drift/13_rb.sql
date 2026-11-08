update clickbooks_us.books set locked_through = null;
create or replace function public.dep() returns jsonb language plpgsql as $$ begin return clickbooks_us.deposit_sync_run(date '2026-11-01', date '2026-11-08', '00000000-0000-0000-0000-0000000000aa'); end $$;
create or replace function public.aff() returns jsonb language plpgsql as $$ begin return clickbooks_us.affiliate_bill_sync_run(date '2026-11-01', date '2026-11-08', '00000000-0000-0000-0000-0000000000aa'); end $$;
create or replace function public.bal_code_like(p text) returns bigint language sql as $$
 select coalesce(sum(l.debit_cents-l.credit_cents),0)::bigint from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where a.code like p $$;
-- B1: PNC CSV-only account + its later Plaid twin
insert into public.bank_connections(id,institution_name) values ('c0000000-0000-0000-0000-000000000001','PNC'),('c0000000-0000-0000-0000-000000000002','PNC Bank');
insert into public.plaid_accounts values ('manual-acct-pnc','PNC checking','1234','depository','c0000000-0000-0000-0000-000000000001'),('plaid-pnc-xyz','Checking','1234','depository','c0000000-0000-0000-0000-000000000002');
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,date,amount_abs,direction) values
 ('d1000000-0000-0000-0000-000000000001','WB1','manual-acct-pnc','unreviewed',null,'2026-11-06',1000,'in'),
 ('d1000000-0000-0000-0000-000000000009','WB1','plaid-pnc-xyz','unreviewed',null,'2026-11-07',5,'out');
select 'B1 map: '||clickbooks_us.bank_map_sync_run('00000000-0000-0000-0000-0000000000aa')::text;
select 'B1 twin shares one ledger account: '||(select count(distinct account_id) from clickbooks_us.bank_ledger_map where provider_account_id in ('manual-acct-pnc','plaid-pnc-xyz'));
select 'B1 again: '||clickbooks_us.bank_map_sync_run('00000000-0000-0000-0000-0000000000aa')::text;
-- D1: deposit 1000 = invoice payment 600 + parked 400
insert into public.accounting_invoices(id,wave_business_id,invoice_date,invoice_number,total_amount,amount_paid) values ('a2000000-0000-0000-0000-000000000002','WB1','2026-11-02','INV-2',600,600);
insert into public.accounting_invoice_items(invoice_id,line_total) values ('a2000000-0000-0000-0000-000000000002',600);
select clickbooks_us.post_journal(b.id,'2026-11-02','Invoice INV-2','accounting_invoice','a2000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('account_id',(select id from clickbooks_us.accounts where code='1100'),'debit_cents','60000','credit_cents','0'),
                    jsonb_build_object('account_id',(select id from clickbooks_us.accounts where code='4000'),'debit_cents','0','credit_cents','60000')),'00000000-0000-0000-0000-0000000000aa') is not null from clickbooks_us.books b;
insert into public.accounting_invoice_payments(id,wave_business_id,accounting_invoice_id,bank_transaction_id,amount,payment_date) values ('b2000000-0000-0000-0000-000000000002','WB1','a2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001',600,'2026-11-06');
insert into public.unapplied_deposits(bank_transaction_id,amount) values ('d1000000-0000-0000-0000-000000000001',400);
update public.bank_transactions set review_status='reviewed', classification='customer_payment', matched_invoice_id='a2000000-0000-0000-0000-000000000002' where id='d1000000-0000-0000-0000-000000000001';
begin isolation level repeatable read; select 'D1 dep: '||dep()::text; commit;
select 'D1 PNC='||bal_code_like('B-%')||' AR='||bal('1100')||' 2400='||bal('2400');
begin isolation level repeatable read; select 'D1 again posted='||(dep()->>'depositsPosted')||' reversed='||(dep()->>'depositsReversed'); commit;
-- D2: part of the parked money now a split to office
update public.unapplied_deposits set amount=300 where bank_transaction_id='d1000000-0000-0000-0000-000000000001';
insert into public.bank_transaction_splits(bank_transaction_id,split_amount,category) values ('d1000000-0000-0000-0000-000000000001',100,'office');
begin isolation level repeatable read; select 'D2 dep: reversed='||(dep()->>'depositsReversed'); commit;
begin isolation level repeatable read; select 'D2 dep: posted='||(dep()->>'depositsPosted'); commit;
select 'D2 PNC='||bal_code_like('B-%')||' AR='||bal('1100')||' 2400='||bal('2400')||' office6000 delta check='||bal('6000');
-- D3: money-out split across two categories; classified must NOT also book it
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,date,amount_abs,direction) values
 ('d3000000-0000-0000-0000-000000000003','WB1','ACC2','reviewed','office','2026-11-06',300,'out');
insert into public.bank_transaction_splits(bank_transaction_id,split_amount,category) values ('d3000000-0000-0000-0000-000000000003',100,'office'),('d3000000-0000-0000-0000-000000000003',200,'rent');
begin isolation level repeatable read; select 'D3 cls posted='||(cls()->>'classifiedPosted'); commit;
select 'D3 before dep 6100='||bal('6100');
begin isolation level repeatable read; select 'D3 dep posted='||(dep()->>'depositsPosted'); commit;
select 'D3 6100='||bal('6100')||' 1020='||bal('1020');
-- D4: classified first, split later -> drift reverses classified, deposit books whole
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,date,amount_abs,direction) values
 ('d4000000-0000-0000-0000-000000000004','WB1','ACC2','reviewed','office','2026-11-07',50,'out');
begin isolation level repeatable read; select 'D4 cls posted='||(cls()->>'classifiedPosted'); commit;
insert into public.bank_transaction_splits(bank_transaction_id,split_amount,category) values ('d4000000-0000-0000-0000-000000000004',20,'office'),('d4000000-0000-0000-0000-000000000004',30,'rent');
begin isolation level repeatable read; select 'D4 drift reversedBank='||(drift()->>'reversedBank'); commit;
begin isolation level repeatable read; select 'D4 dep posted='||(dep()->>'depositsPosted'); commit;
select 'D4 live entries for txn: '||(select count(*) from clickbooks_us.journals j where j.source_id like 'd4000000-0000-0000-0000-000000000004%' and not exists(select 1 from clickbooks_us.journals r where r.reverses_id=j.id));
-- A1: NextTrade advance + a bill it paid for us
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,third_party_payer,date,amount_abs,direction) values
 ('a1000000-0000-0000-0000-00000000000a','WB1','ACC1','reviewed',null,'NextTrade Industries','2026-11-05',1000,'out');
begin isolation level repeatable read; select 'A1 cls: '||cls()::text; commit;
select 'A1 Due from NextTrade='||bal_code_like('D-%')||' expense untouched office='||bal('6000');
begin isolation level repeatable read; select 'A1 drift no loop reversedBank='||(drift()->>'reversedBank'); commit;
insert into public.vendor_bills(id,vendor_name,category,paid_via) values ('fb000000-0000-0000-0000-00000000000b','Texas Electric','office_supplies','NextTrade Industries'),('fb000000-0000-0000-0000-00000000000c','Some vendor','office','RTM Capital');
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('fa000000-0000-0000-0000-00000000000b','fb000000-0000-0000-0000-00000000000b',400,'2026-11-05','a1000000-0000-0000-0000-00000000000a','rtm'),
 ('fa000000-0000-0000-0000-00000000000c','fb000000-0000-0000-0000-00000000000c',70,'2026-11-05',null,'rtm');
begin isolation level repeatable read; select 'A1 bills: '||aff()::text; commit;
select 'A1 Due='||bal_code_like('D-%')||' Office Supplies (new approved account)='||bal_code_like('H-%')||' unapproved Wave W-1 untouched='||bal('W-1');
begin isolation level repeatable read; select 'A1 again posted='||(aff()->>'billsPosted')||' reversed='||(aff()->>'billsReversed'); commit;
update public.vendor_bill_payments set voided=true where id='fa000000-0000-0000-0000-00000000000b';
begin isolation level repeatable read; select 'A1 void reversed='||(aff()->>'billsReversed'); commit;
select 'A1 after void Due='||bal_code_like('D-%');
-- O1: opening balance
select 'O1: '||public.clickbooks_us_bank_opening_balance('PNC','1234',5000);
select 'O1 again: '||public.clickbooks_us_bank_opening_balance('PNC','1234',5000);
select 'O1 PNC='||bal_code_like('B-%');
select 'TRIAL BALANCE nets to zero: '||(select sum(debit_cents-credit_cents) from clickbooks_us.journal_lines);
