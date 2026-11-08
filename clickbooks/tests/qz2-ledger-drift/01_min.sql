alter table clickbooks_us.books add column historical_data_ready boolean not null default false;
alter table clickbooks_us.books add column opening_cutoff date;
create table clickbooks_us.workflow_events (id bigint generated always as identity primary key, kind text not null, object_id uuid, actor_id uuid, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table clickbooks_us.migration_runs (id uuid primary key default gen_random_uuid(), state text);
create table clickbooks_us.opening_subledger (book_id uuid, run_id uuid, kind text, source_ref text, amount_cents bigint);
create table clickbooks_us.bank_ledger_map (
 book_id uuid not null references clickbooks_us.books(id), provider_account_id text not null,
 account_id uuid not null, reviewed boolean not null default false, evidence text,
 primary key(book_id,provider_account_id), foreign key(book_id,account_id) references clickbooks_us.accounts(book_id,id));
create function clickbooks_us.money_cents(p text) returns bigint language plpgsql immutable security invoker set search_path='' as $$
declare n numeric; begin
 if p is null or p !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'CB_INVALID_SOURCE_AMOUNT'; end if;
 n:=p::numeric*100;
 if n<>trunc(n) or n>999999999999999 then raise exception 'CB_INVALID_SOURCE_AMOUNT'; end if;
 return n::bigint;
end $$;
create table clickbooks_us.posting_defaults (book_id uuid primary key, invoice_income_account_id uuid, reviewed boolean not null default false);
create table clickbooks_us.cutover_control (singleton boolean primary key default true, phase text not null default 'parallel', shadow_sync_enabled boolean not null default true);
insert into clickbooks_us.cutover_control(singleton) values (true);
create table clickbooks_us.classification_account_map(classification text primary key, account_id uuid not null references clickbooks_us.accounts(id), reviewed boolean not null default false, evidence text, updated_at timestamptz not null default now());
create table public.expense_categories(key text primary key, label text, kind text);
create table public.bank_transactions(id uuid primary key default gen_random_uuid(), wave_business_id text, account_id text, pending boolean default false, iso_currency text default 'USD',
  review_status text default 'unreviewed', classification text, third_party_payer text, matched_invoice_id uuid, linked_id uuid, transfer_group_id uuid, date date, posted_date date, amount_abs numeric, direction text);
create table public.accounting_invoices(id uuid primary key default gen_random_uuid(), wave_business_id text, currency text default 'USD', record_status text default 'active', approval_status text default 'approved',
  invoice_date date, invoice_number text, total_amount numeric, amount_paid numeric default 0);
create table public.accounting_invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid, line_total numeric);
create table public.accounting_invoice_payments(id uuid primary key default gen_random_uuid(), wave_business_id text, accounting_invoice_id uuid references public.accounting_invoices(id) on delete cascade,
  bank_transaction_id uuid, amount numeric, payment_date date, voided boolean default false);
-- seed book + chart
insert into clickbooks_us.books(code,name,wave_business_id,posting_enabled,historical_data_ready,opening_cutoff) values ('KTC_US','KTC','WB1',true,true,date '2026-10-31');
insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,is_bank_sensitive,needs_review,origin)
 select id,v.code,v.name,v.t,v.s,v.bs,v.nr,'control' from clickbooks_us.books,(values
  ('1010','Chase 6338','asset','debit',true,false),('1020','Chase 6353','asset','debit',true,false),
  ('1090','Inter-account transfer clearing','asset','debit',true,true),('1100','Accounts receivable','asset','debit',false,false),
  ('4000','Sales','income','credit',false,false),('2400','Unapplied customer receipts','liability','credit',false,false),('3000','Opening balance offset','equity','credit',false,true),('W-1','Office Supplies','expense','debit',false,true),('6000','Office','expense','debit',false,false),('6100','Rent','expense','debit',false,false)) v(code,name,t,s,bs,nr);
insert into clickbooks_us.bank_ledger_map select b.id,'ACC1',a.id,true,'test evidence long' from clickbooks_us.books b join clickbooks_us.accounts a on a.code='1010';
insert into clickbooks_us.bank_ledger_map select b.id,'ACC2',a.id,true,'test evidence long' from clickbooks_us.books b join clickbooks_us.accounts a on a.code='1020';
insert into clickbooks_us.posting_defaults select b.id,a.id,true from clickbooks_us.books b join clickbooks_us.accounts a on a.code='4000';
insert into clickbooks_us.classification_account_map select 'office',id,true,'x' from clickbooks_us.accounts where code='6000';
insert into clickbooks_us.classification_account_map select 'rent',id,true,'x' from clickbooks_us.accounts where code='6100';
insert into public.expense_categories values ('office','Office','expense'),('rent','Rent','expense'),('meals','Meals and entertainment','expense'),('transfer','Transfer','not_pnl');

create table public.plaid_accounts(plaid_account_id text primary key, name text, mask text, type text default 'depository', connection_id uuid);
create table public.bank_connections(id uuid primary key default gen_random_uuid(), institution_name text);
create table public.unapplied_deposits(id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, amount numeric, status text default 'open');
create table public.customer_credits(id uuid primary key default gen_random_uuid(), source_transaction_id uuid, amount numeric, status text default 'open');
create table public.bank_transaction_splits(id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, split_amount numeric, category text, linked_type text);
create table public.vendor_bills(id uuid primary key default gen_random_uuid(), vendor_name text, category text, paid_via text, record_status text default 'active');
create table public.vendor_bill_payments(id uuid primary key default gen_random_uuid(), bill_id uuid, amount numeric, paid_date date, bank_transaction_id uuid, method text, voided boolean default false);
create table public.paid_through_parties(name text primary key, kind text, remainder_label text, active boolean default true, sort int default 100);
insert into public.paid_through_parties(name,kind,remainder_label,sort) values ('RTM Capital','service_provider','fee',10),('NextTrade Industries','affiliate','advance',20);
create table clickbooks_us.rule_proposals(id uuid); create table clickbooks_us.rules(id uuid); create table clickbooks_us.shadow_sync_runs(id uuid);
insert into public.expense_categories values ('office_supplies','Office Supplies','expense');
