-- v55.83-SP — a closed month stays closed (local Postgres only; run after 01_scen.sql)
\set u1 '''00000000-0000-0000-0000-0000000000a1'''
create schema if not exists clickbooks_us;
create table if not exists clickbooks_us.books(code text primary key, locked_through date);
insert into clickbooks_us.books(code, locked_through) values ('KTC_US', '2026-09-30') on conflict (code) do update set locked_through = excluded.locked_through;
insert into public.bank_transactions(id,wave_business_id,account_id,date,posted_date,amount_abs,direction,name,third_party_payer) values
 ('cccccccc-0000-0000-0000-000000000009','US','ACC1','2026-09-10','2026-09-10',5000,'out','ONLINE TRANSFER TO CHK 9909','RTM Capital') on conflict do nothing;
insert into public.vendor_bills(id,vendor_name,bill_number,total_amount,paid_via) values ('bbbbbbbb-0000-0000-0000-000000000009','Vendor E','E-9',4000,'RTM Capital') on conflict do nothing;
select public.mk('dddddddd-0000-0000-0000-000000000009', 300, 'cccccccc-0000-0000-0000-000000000009', '[["bbbbbbbb-0000-0000-0000-000000000009",4000]]');
select public.sign('dddddddd-0000-0000-0000-000000000009');
select 'G1 transfer of Sep 10, books closed through Sep 30: '||(public.wire_request_send('dddddddd-0000-0000-0000-000000000009', :u1, '2026-11-15')->>'why');
select 'G1 nothing recorded: payments='||(select count(*) from public.vendor_bill_payments where bill_id='bbbbbbbb-0000-0000-0000-000000000009')||' status='||(select status from public.wire_packages where id='dddddddd-0000-0000-0000-000000000009');
update clickbooks_us.books set locked_through = '2026-08-31' where code='KTC_US';
select 'G2 month reopened (closed through Aug 31): '||public.wire_request_send('dddddddd-0000-0000-0000-000000000009', :u1, '2026-11-15')::text;
update clickbooks_us.books set locked_through = '2026-09-30' where code='KTC_US';
select 'G3 fee change after the month is closed again: '||(public.wire_request_fee_change('dddddddd-0000-0000-0000-000000000009', 500, :u1)->>'why');
select 'G3 fee unchanged='||fee_amount from public.wire_packages where id='dddddddd-0000-0000-0000-000000000009';
select 'G4 payments per bank line (bills paid, live): '||string_agg(x.t||' → '||x.n||' payment(s) $'||x.s, ' | ' order by x.t) from (select right(bank_transaction_id::text,2) t, count(*) n, sum(amount) s from public.vendor_bill_payments where voided is not true group by 1) x;
drop table clickbooks_us.books; drop schema clickbooks_us;
