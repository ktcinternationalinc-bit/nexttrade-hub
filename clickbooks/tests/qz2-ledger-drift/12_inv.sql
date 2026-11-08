insert into public.accounting_invoices(id,wave_business_id,invoice_date,invoice_number,total_amount,amount_paid) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','WB1','2026-11-02','INV-1',1000,1000);
insert into public.accounting_invoice_items(invoice_id,line_total) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',1000);
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,matched_invoice_id,date,amount_abs,direction) values
 ('44444444-4444-4444-4444-444444444444','WB1','ACC2','reviewed','customer_payment','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','2026-11-05',1000,'in');
insert into public.accounting_invoice_payments(id,wave_business_id,accounting_invoice_id,bank_transaction_id,amount,payment_date) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','WB1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44444444-4444-4444-4444-444444444444',1000,'2026-11-05');
-- engine-style postings
select clickbooks_us.post_journal(b.id,'2026-11-02','Invoice INV-1','accounting_invoice','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  jsonb_build_array(jsonb_build_object('account_id',(select id from clickbooks_us.accounts where code='1100'),'debit_cents','100000','credit_cents','0'),
                    jsonb_build_object('account_id',(select id from clickbooks_us.accounts where code='4000'),'debit_cents','0','credit_cents','100000')),'00000000-0000-0000-0000-0000000000aa') is not null from clickbooks_us.books b;
select clickbooks_us.post_journal(b.id,'2026-11-05','Invoice payment x','accounting_invoice_payment','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  jsonb_build_array(jsonb_build_object('account_id',(select id from clickbooks_us.accounts where code='1020'),'debit_cents','100000','credit_cents','0'),
                    jsonb_build_object('account_id',(select id from clickbooks_us.accounts where code='1100'),'debit_cents','0','credit_cents','100000')),'00000000-0000-0000-0000-0000000000aa') is not null from clickbooks_us.books b;
select 'S6 start AR='||bal('1100')||' 1020='||bal('1020')||' 4000='||bal('4000');
begin isolation level repeatable read; select 'S6 drift no-change: '||drift()::text; commit;
-- unmatch: void the payment
update public.accounting_invoice_payments set voided=true where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.accounting_invoices set amount_paid=0 where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.bank_transactions set matched_invoice_id=null, review_status='unreviewed' where id='44444444-4444-4444-4444-444444444444';
begin isolation level repeatable read; select 'S6 void: '||drift()::text; commit;
select 'S6 after void AR='||bal('1100')||' 1020='||bal('1020');
-- re-match revives the voided row
update public.accounting_invoice_payments set voided=false where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.accounting_invoices set amount_paid=1000 where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.bank_transactions set matched_invoice_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', review_status='reviewed' where id='44444444-4444-4444-4444-444444444444';
begin isolation level repeatable read; select 'S6 revive: '||drift()::text; commit;
select 'S6 after revive AR='||bal('1100')||' 1020='||bal('1020');
-- S7 edit invoice total 1000 -> 1200 (discount removed / line added)
update public.accounting_invoice_items set line_total=1200 where invoice_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.accounting_invoices set total_amount=1200 where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin isolation level repeatable read; select 'S7 edit: '||drift()::text; commit;
select 'S7 after edit AR='||bal('1100')||' 4000='||bal('4000');
begin isolation level repeatable read; select 'S7 idempotent: '||(drift()->>'reversedInvoices')||'/'||(drift()->>'repostedInvoices'); commit;
-- S8 delete invoice (cascade deletes the payment)
delete from public.accounting_invoices where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin isolation level repeatable read; select 'S8 delete: '||drift()::text; commit;
select 'S8 after delete AR='||bal('1100')||' 4000='||bal('4000')||' 1020='||bal('1020');
select 'journals: '||count(*)||' reversals: '||count(*) filter (where source_kind='reversal') from clickbooks_us.journals;
-- locked period: reversal lands on first open day
update clickbooks_us.books set locked_through='2026-11-04';
update public.bank_transactions set classification='rent' where id='11111111-1111-1111-1111-111111111111';
begin isolation level repeatable read; select 'S11 locked drift: '||drift()::text; commit;
select 'S11 reversal date: '||max(entry_date) from clickbooks_us.journals where source_kind='reversal';
begin isolation level repeatable read; select 'S11 cls (repost into locked date should be caught?): '||cls()::text; commit;
