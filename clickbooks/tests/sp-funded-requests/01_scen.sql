-- v55.83-SP scenarios (local Postgres only): requests drawn from one transfer.
\set u1 '''00000000-0000-0000-0000-0000000000a1'''
\set u2 '''00000000-0000-0000-0000-0000000000a2'''
\set T  '''cccccccc-0000-0000-0000-000000000001'''
\i ../../../sql/v55-83-SP-funded-requests.sql
insert into public.bank_transactions(id,wave_business_id,account_id,date,posted_date,amount_abs,direction,name,third_party_payer) values
 (:T,'US','ACC1','2026-10-02','2026-10-02',50000,'out','ONLINE TRANSFER TO CHK 9909','RTM Capital'),
 ('cccccccc-0000-0000-0000-000000000002','US','ACC1','2026-10-05','2026-10-05',9000,'out','WIRE OUT VENDOR D',null);
insert into public.vendor_bills(id,vendor_name,bill_number,total_amount,paid_via) values
 ('bbbbbbbb-0000-0000-0000-000000000001','Vendor A','A-101',20000,'RTM Capital'),
 ('bbbbbbbb-0000-0000-0000-000000000002','Vendor B','B-77',18300,null),
 ('bbbbbbbb-0000-0000-0000-000000000003','Vendor C','C-12',14000,'RTM Capital'),
 ('bbbbbbbb-0000-0000-0000-000000000004','Vendor D','D-1',9000,null);
create or replace function public.mk(p_id uuid, p_fee numeric, p_fund uuid, p_lines jsonb) returns void language plpgsql as $$
declare x jsonb; begin
  insert into public.wire_packages(id,payee_kind,payee_name,fee_amount,funding_txn_id,created_by) values (p_id,'service_provider','RTM Capital',p_fee,p_fund,'00000000-0000-0000-0000-0000000000a1');
  for x in select * from jsonb_array_elements(p_lines) loop
    insert into public.wire_package_lines(package_id,bill_id,amount,marked_paid_via) values (p_id,(x->>0)::uuid,(x->>1)::numeric,coalesce((x->>2)::boolean,false));
  end loop; end $$;
create or replace function public.sign(p_id uuid) returns void language sql as $$
  update public.wire_packages set signoff1_by='00000000-0000-0000-0000-0000000000a1', signoff1_at=now(), signoff2_by='00000000-0000-0000-0000-0000000000a2', signoff2_at=now() where id=p_id $$;
select 'F0 nothing used yet: '||public.wire_funding_summary(:T, null)::text;
-- request 1: A in full + B in full (B gets marked paid through RTM) + fee 1,000 = 39,300
select public.mk('dddddddd-0000-0000-0000-000000000001', 1000, :T, '[["bbbbbbbb-0000-0000-0000-000000000001",20000],["bbbbbbbb-0000-0000-0000-000000000002",18300,true]]');
select 'F1 no signatures: '||(public.wire_request_send('dddddddd-0000-0000-0000-000000000001', :u1, '2026-10-03')->>'why');
select public.sign('dddddddd-0000-0000-0000-000000000001');
select 'F2 future date: '||(public.wire_request_send('dddddddd-0000-0000-0000-000000000001', :u1, current_date + 3)->>'why');
select 'F3 send request 1: '||public.wire_request_send('dddddddd-0000-0000-0000-000000000001', :u1, '2026-10-03')::text;
select 'F3 status='||status||' bank line is the transfer='||(bank_transaction_id = :T)||' approved_total='||approved_total||' sent_date='||sent_date from public.wire_packages where id='dddddddd-0000-0000-0000-000000000001';
select 'F3 payments: '||string_agg(amount||' on '||paid_date||' '||method, ' | ' order by amount) from public.vendor_bill_payments where bank_transaction_id = :T;
select 'F3 B marked paid through: '||paid_via from public.vendor_bills where bill_number='B-77';
select 'F4 after request 1: '||public.wire_funding_summary(:T, null)::text;
select 'F5 send twice: '||(public.wire_request_send('dddddddd-0000-0000-0000-000000000001', :u1, '2026-10-03')->>'why');
-- request 2 on the SAME transfer: C in full 14,000 + fee 500 = 14,500 > 10,700 left → refused
select public.mk('dddddddd-0000-0000-0000-000000000002', 500, :T, '[["bbbbbbbb-0000-0000-0000-000000000003",14000]]');
select public.sign('dddddddd-0000-0000-0000-000000000002');
select 'F6 over the transfer: '||(public.wire_request_send('dddddddd-0000-0000-0000-000000000002', :u2, '2026-10-20')->>'why');
select 'F6 nothing recorded: payments on C='||(select count(*) from public.vendor_bill_payments where bill_id='bbbbbbbb-0000-0000-0000-000000000003')||' status='||(select status from public.wire_packages where id='dddddddd-0000-0000-0000-000000000002');
-- split the last bill so it fits exactly: 10,200 of 14,000 + fee 500 = 10,700
update public.wire_package_lines set amount = 10200 where package_id='dddddddd-0000-0000-0000-000000000002';
select 'F7 second request on the same transfer: '||public.wire_request_send('dddddddd-0000-0000-0000-000000000002', :u2, '2026-10-20')::text;
select 'F7 transfer fully used: '||public.wire_funding_summary(:T, null)::text;
select 'F7 C-12 partly paid: paid='||(select sum(amount) from public.vendor_bill_payments where bill_id='bbbbbbbb-0000-0000-0000-000000000003' and voided is not true)||' of 14000';
select 'F7 two requests share one bank line: '||(select count(*) from public.wire_packages where bank_transaction_id = :T and status='attached');
-- fee change after sending
select 'F8 raise fee beyond the room: '||(public.wire_request_fee_change('dddddddd-0000-0000-0000-000000000002', 501, :u1)->>'why');
select 'F9 lower fee 500→200: '||public.wire_request_fee_change('dddddddd-0000-0000-0000-000000000002', 200, :u1)::text;
select 'F9 signatures untouched='||(signoff1_by is not null and signoff2_by is not null)||' fee='||fee_amount||' approved_total='||approved_total from public.wire_packages where id='dddddddd-0000-0000-0000-000000000002';
select 'F9 now waiting for bills: '||(public.wire_funding_summary(:T, null)->>'remaining');
do $$ begin update public.wire_packages set fee_amount = 9999 where id='dddddddd-0000-0000-0000-000000000002'; raise notice 'F10 FAIL: fee changed outside the function'; exception when others then raise notice 'F10 direct fee change refused: %', sqlerrm; end $$;
do $$ begin update public.wire_packages set funding_txn_id = 'cccccccc-0000-0000-0000-000000000002' where id='dddddddd-0000-0000-0000-000000000002'; raise notice 'F11 FAIL'; exception when others then raise notice 'F11 moving a sent request to another transfer refused: %', sqlerrm; end $$;
-- an ordinary wire still owns its bank line alone
insert into public.wire_packages(id,payee_kind,payee_name,status,signoff1_by,signoff2_by,sent_by,approved_total,bank_transaction_id) values
 ('eeeeeeee-0000-0000-0000-000000000001','vendor','Vendor D','attached',:u1,:u2,:u1,9000,'cccccccc-0000-0000-0000-000000000002');
do $$ begin insert into public.wire_packages(id,payee_kind,payee_name,status,signoff1_by,signoff2_by,sent_by,approved_total,bank_transaction_id) values
 ('eeeeeeee-0000-0000-0000-000000000002','vendor','Vendor D','attached','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1',9000,'cccccccc-0000-0000-0000-000000000002');
 raise notice 'F12 FAIL: two ordinary wires on one line'; exception when others then raise notice 'F12 two ordinary wires on one bank line refused: %', sqlerrm; end $$;
do $$ begin insert into public.wire_packages(payee_kind,payee_name,funding_txn_id) values ('vendor','Vendor D','cccccccc-0000-0000-0000-000000000002'); raise notice 'F13 FAIL'; exception when others then raise notice 'F13 a request straight to a vendor refused: %', sqlerrm; end $$;
-- wrong payee / internal transfer / closed month
select public.mk('dddddddd-0000-0000-0000-000000000003', 0, 'cccccccc-0000-0000-0000-000000000002', '[["bbbbbbbb-0000-0000-0000-000000000004",100]]');
select public.sign('dddddddd-0000-0000-0000-000000000003');
select 'F14 transfer not marked as sent to RTM: '||(public.wire_request_send('dddddddd-0000-0000-0000-000000000003', :u1, '2026-10-06')->>'why');
update public.bank_transactions set third_party_payer='RTM Capital', transfer_group_id=gen_random_uuid() where id='cccccccc-0000-0000-0000-000000000002';
select 'F15 line linked as an internal transfer: '||(public.wire_request_send('dddddddd-0000-0000-0000-000000000003', :u1, '2026-10-06')->>'why');
-- undo request 2 (the Hub's reverse): its payments are voided, its part of the transfer is free again, request 1 untouched
update public.vendor_bill_payments set voided = true where id in (select payment_id from public.wire_package_lines where package_id='dddddddd-0000-0000-0000-000000000002');
update public.wire_packages set status='reversed', reversed_by=:u1, reversed_at=now(), reverse_note='test undo of one request', bank_transaction_id=null where id='dddddddd-0000-0000-0000-000000000002';
select 'F16 after undoing request 2 only: '||public.wire_funding_summary(:T, null)::text;
select 'F16 request 1 still attached='||(select status from public.wire_packages where id='dddddddd-0000-0000-0000-000000000001')||' its payments live='||(select count(*) from public.vendor_bill_payments p join public.wire_package_lines l on l.payment_id=p.id where l.package_id='dddddddd-0000-0000-0000-000000000001' and p.voided is not true);
select 'F17 no bill overpaid: '||coalesce((select string_agg(b.bill_number, ',') from public.vendor_bills b where (select coalesce(sum(p.amount),0) from public.vendor_bill_payments p where p.bill_id=b.id and p.voided is not true) > b.total_amount + 0.005), 'none');
select 'F18 one payment per bill per request (no duplicates): '||coalesce((select string_agg(x.c::text, ',') from (select count(*) c from public.vendor_bill_payments where voided is not true group by bill_id, bank_transaction_id having count(*) > 1) x), 'none');
select 'F19 re-run of the SQL file is safe:';
\i ../../../sql/v55-83-SP-funded-requests.sql
