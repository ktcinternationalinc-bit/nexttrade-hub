-- v55.83-SR — NextTrade booked like RTM from 2026-11-15; older entries stay as booked. Local Postgres only.
-- Run on a copy of the ledger test database (after qz2-ledger-drift 00 … 17).
\set u '''00000000-0000-0000-0000-0000000000aa'''
update clickbooks_us.books set locked_through = null;
create or replace function public.cls2() returns jsonb language sql as $$ select clickbooks_us.classified_sync_run(date '2026-11-01', date '2026-11-16', '00000000-0000-0000-0000-0000000000aa') $$;
create or replace function public.aff2() returns jsonb language sql as $$ select clickbooks_us.affiliate_bill_sync_run(date '2026-11-01', date '2026-11-16', '00000000-0000-0000-0000-0000000000aa') $$;
create or replace function public.ap2() returns jsonb language sql as $$ select clickbooks_us.payable_sync_run('2026-11-01','2026-11-16','00000000-0000-0000-0000-0000000000aa') $$;
create or replace function public.due() returns numeric language sql as $$ select coalesce(sum(l.debit_cents-l.credit_cents),0)/100.0 from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where a.code like 'D-%' $$;
create or replace function public.acc(c text) returns numeric language sql as $$ select coalesce(sum(l.debit_cents-l.credit_cents),0)/100.0 from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where a.code = c $$;
create or replace function public.sup() returns numeric language sql as $$ select coalesce(sum(l.debit_cents-l.credit_cents),0)/100.0 from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where a.code like 'H-2a7f%' $$;
create or replace function public.tb() returns bigint language sql as $$ select coalesce(sum(debit_cents-credit_cents),0)::bigint from clickbooks_us.journal_lines $$;
create or replace function public.live_for(p text) returns text language sql as $$ select coalesce(string_agg(a.code||':'||(l.debit_cents-l.credit_cents), ' ' order by a.code), 'none') from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id join clickbooks_us.accounts a on a.id=l.account_id
  where j.source_id like p||'%' and j.reverses_id is null and not exists(select 1 from clickbooks_us.journals r where r.reverses_id=j.id) $$;

-- ── BEFORE the change: one NextTrade transfer dated Nov 16 and a bill it paid, booked the OLD way
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,third_party_payer,date,amount_abs,direction) values
 ('e1000000-0000-0000-0000-000000000018','WB1','ACC1','reviewed','office','NextTrade Industries','2026-11-16',300,'out');
insert into public.vendor_bills(id,vendor_name,category,paid_via) values ('eb000000-0000-0000-0000-000000000018','Late vendor','office_supplies','NextTrade Industries');
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('ea000000-0000-0000-0000-000000000018','eb000000-0000-0000-0000-000000000018',100,'2026-11-16','e1000000-0000-0000-0000-000000000018','rtm');
begin isolation level repeatable read; select 'R0 old rule, line of Nov 16: posted='||(cls2()->>'classifiedPosted'); commit;
begin isolation level repeatable read; select 'R0 old rule, its bill: posted='||(aff2()->>'billsPosted'); commit;
select 'R0 old way → Nov 16 line: '||live_for('e1000000-0000-0000-0000-000000000018')||' | its bill: '||live_for('affbill:ea000000-0000-0000-0000-000000000018');
create table public.sr_before as select j.id, j.entry_date, j.status, j.reverses_id, j.source_id from clickbooks_us.journals j;
create table public.sr_bal_before as select a.code, sum(l.debit_cents-l.credit_cents) bal from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id join clickbooks_us.journals j on j.id=l.journal_id where j.entry_date < date '2026-11-15' group by 1;
select 'R0 before: journals='||(select count(*) from public.sr_before)||' Due from NextTrade='||due()||' Office='||acc('6000')||' Office supplies='||sup()||' trial balance='||tb();

-- ── the change
\i ../../../sql/v55-83-SR-provider-from.sql
select 'R1 provider_from: '||string_agg(name||'='||coalesce(provider_from::text,'null'), ', ' order by name) from public.paid_through_parties;

-- ── older entries stay as booked
begin isolation level repeatable read; select 'R2 nightly check: reversedBank='||(drift()->>'reversedBank'); commit;
begin isolation level repeatable read; select 'R2 bills: reversed='||(aff2()->>'billsReversed')||' posted='||(aff2()->>'billsPosted'); commit;
begin isolation level repeatable read; select 'R2 re-post: classifiedPosted='||(cls2()->>'classifiedPosted'); commit;
select 'R2 entries dated before Nov 15 that changed: '||(select count(*) from public.sr_before b join clickbooks_us.journals j on j.id=b.id where b.entry_date < date '2026-11-15' and (j.status is distinct from b.status or exists(select 1 from clickbooks_us.journals r where r.reverses_id=j.id and not exists(select 1 from public.sr_before x where x.id=r.id))));
select 'R2 balances of entries dated before Nov 15, account by account, that differ: '||(select count(*) from (select a.code, sum(l.debit_cents-l.credit_cents) bal from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id join clickbooks_us.journals j on j.id=l.journal_id where j.entry_date < date '2026-11-15' group by 1) n full join public.sr_bal_before o using (code) where n.bal is distinct from o.bal);
select 'R2 the Nov 5 NextTrade advance is still an advance: '||live_for('a1000000-0000-0000-0000-00000000000a');
-- ── the Nov 16 line was booked the old way → reversed and re-posted as one line by its category; its bill entry reversed
select 'R3 Nov 16 line now: '||live_for('e1000000-0000-0000-0000-000000000018')||' | its bill entry now: '||live_for('affbill:ea000000-0000-0000-0000-000000000018');
select 'R3 the old entries were REVERSED, not edited: reversals added='||(select count(*) from clickbooks_us.journals j where j.reverses_id is not null and not exists(select 1 from public.sr_before b where b.id=j.id))||' journals edited='||(select count(*) from public.sr_before b join clickbooks_us.journals j on j.id=b.id where j.entry_date is distinct from b.entry_date or j.source_id is distinct from b.source_id);
select 'R3 Due from NextTrade='||due()||' Office='||acc('6000')||' Office supplies='||sup()||' trial balance='||tb();

-- ── a new transfer on the first day (Nov 15) and a bill paid from it
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,third_party_payer,date,amount_abs,direction) values
 ('e1000000-0000-0000-0000-000000000015','WB1','ACC1','reviewed','office','NextTrade Industries','2026-11-15',2000,'out');
insert into public.vendor_bills(id,vendor_name,category,paid_via) values ('eb000000-0000-0000-0000-000000000015','New vendor','office_supplies','NextTrade Industries');
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('ea000000-0000-0000-0000-000000000015','eb000000-0000-0000-0000-000000000015',1500,'2026-11-15','e1000000-0000-0000-0000-000000000015','rtm');
begin isolation level repeatable read; select 'R4 line of Nov 15: posted='||(cls2()->>'classifiedPosted'); commit;
begin isolation level repeatable read; select 'R4 its bill: posted='||(aff2()->>'billsPosted')||' (want 0 — one line, like RTM)'; commit;
select 'R4 Nov 15 line: '||live_for('e1000000-0000-0000-0000-000000000015')||' | bill entry: '||live_for('affbill:ea000000-0000-0000-0000-000000000015');
select 'R4 why no bill entry: '||(clickbooks_us.affbill_lines((select id from clickbooks_us.books where code='KTC_US'), 'ea000000-0000-0000-0000-000000000015')->>'why');

-- ── a transfer entered late but DATED before Nov 15 still follows the old rule
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,third_party_payer,date,amount_abs,direction) values
 ('e1000000-0000-0000-0000-000000000012','WB1','ACC1','reviewed','office','NextTrade Industries','2026-11-12',800,'out');
insert into public.vendor_bills(id,vendor_name,category,paid_via) values ('eb000000-0000-0000-0000-000000000012','Old vendor','office_supplies','NextTrade Industries');
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('ea000000-0000-0000-0000-000000000012','eb000000-0000-0000-0000-000000000012',250,'2026-11-12','e1000000-0000-0000-0000-000000000012','rtm');
begin isolation level repeatable read; select 'R5 line dated Nov 12: posted='||(cls2()->>'classifiedPosted'); commit;
begin isolation level repeatable read; select 'R5 its bill: posted='||(aff2()->>'billsPosted'); commit;
select 'R5 Nov 12 line: '||live_for('e1000000-0000-0000-0000-000000000012')||' | bill entry: '||live_for('affbill:ea000000-0000-0000-0000-000000000012');

-- ── RTM is untouched
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,third_party_payer,date,amount_abs,direction) values
 ('e1000000-0000-0000-0000-000000000099','WB1','ACC1','reviewed','office','RTM Capital','2026-11-16',900,'out');
begin isolation level repeatable read; select 'R6 RTM line: posted='||(cls2()->>'classifiedPosted'); commit;
select 'R6 RTM line: '||live_for('e1000000-0000-0000-0000-000000000099');

-- ── a NextTrade bill already on the books (accounts payable) before Nov 15, paid from a transfer after it
update clickbooks_us.accounts set needs_review=false where code='2000';
select 'R7 bills on the books switched on: '||(public.clickbooks_us_payables_set_start('2026-11-02', :u)->>'ok');
alter table public.vendor_bills add column if not exists validation_status text, add column if not exists bill_date date, add column if not exists total_amount numeric;
insert into public.vendor_bills(id,vendor_name,category,paid_via,validation_status,bill_date,total_amount) values
 ('eb000000-0000-0000-0000-000000000010','On the books','office_supplies','NextTrade Industries','validated','2026-11-10',600),
 ('eb000000-0000-0000-0000-000000000016','New, after','office_supplies','NextTrade Industries','validated','2026-11-16',350);
create table public.sr_ap0 as select coalesce(sum(l.credit_cents-l.debit_cents),0)/100.0 v from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where a.code='2000';
begin isolation level repeatable read; select 'R7 run: '||(ap2()->>'billsOnBooks')||' bill(s) put on the books'; commit;
select 'R7 the Nov 10 bill is on the books: '||live_for('apbill:eb000000-0000-0000-0000-000000000010')||' | the Nov 16 bill is NOT (one line, like RTM): '||live_for('apbill:eb000000-0000-0000-0000-000000000016');
insert into public.vendor_bill_payments(id,bill_id,amount,paid_date,bank_transaction_id,method) values ('ea000000-0000-0000-0000-000000000010','eb000000-0000-0000-0000-000000000010',600,'2026-11-15','e1000000-0000-0000-0000-000000000015','rtm');
begin isolation level repeatable read; select 'R7 bills run: posted='||(aff2()->>'billsPosted'); commit;
begin isolation level repeatable read; select 'R7 payables run: '||ap2()::text; commit;
select 'R7 its payment clears the payable (no advance entry): '||live_for('appay:ea000000-0000-0000-0000-000000000010')||' | payable still owed from this scenario='||((select coalesce(sum(l.credit_cents-l.debit_cents),0)/100.0 from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where a.code='2000') - (select v from public.sr_ap0));

-- ── steady state, totals, and running the script again
begin isolation level repeatable read; select 'R8 nightly check again: reversedBank='||(drift()->>'reversedBank'); commit;
begin isolation level repeatable read; select 'R8 again: classifiedPosted='||(cls2()->>'classifiedPosted')||' billsPosted='||(aff2()->>'billsPosted')||' billsReversed='||(aff2()->>'billsReversed'); commit;
select 'R8 Due from NextTrade='||due()||' Office='||acc('6000')||' Office supplies='||sup()||' trial balance='||tb();
\i ../../../sql/v55-83-SR-provider-from.sql
select 'R9 after running the script twice: callers on the dated rule='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clickbooks_us' and p.proname in ('classified_sync_run','drift_sync_run','affbill_lines','apbill_lines','appay_lines') and pg_get_functiondef(p.oid) like '%affiliate_due_account(%, %, %)%')||' still on the undated rule='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clickbooks_us' and p.proname in ('classified_sync_run','drift_sync_run') and pg_get_functiondef(p.oid) like '%affiliate_due_account(b.id, t.third_party_payer)%');
drop table public.sr_before, public.sr_bal_before, public.sr_ap0;
