-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PB — VENDOR BILLS (Accounts Payable)
-- Max (Nov 5): "add a vendors bill side and create a dashboard for that as
-- well.. to see how money will move in and out for a period of time...
-- compare what funds coming in to pay bills"
--
-- Bills you OWE: entered (scan comes later), tracked open/partial/paid,
-- and paid by linking the real bank transaction. Browser reads; all writes
-- go through the service-role API with bills.manage permission.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  wave_business_id text,
  vendor_name text not null,
  bill_number text,
  bill_date date not null,
  due_date date,
  currency text not null default 'USD',
  total_amount numeric not null check (total_amount > 0),
  category text,
  notes text,
  record_status text not null default 'active' check (record_status in ('active','void')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.vendor_bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.vendor_bills(id),
  amount numeric not null check (amount > 0),
  paid_date date not null,
  bank_transaction_id uuid,
  method text,
  voided boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_vendor_bills_due on public.vendor_bills (due_date);
create index if not exists idx_vendor_bills_date on public.vendor_bills (bill_date);
create index if not exists idx_vendor_bills_status on public.vendor_bills (record_status);
create index if not exists idx_vbp_bill on public.vendor_bill_payments (bill_id);
create index if not exists idx_vbp_bank on public.vendor_bill_payments (bank_transaction_id);

alter table public.vendor_bills enable row level security;
alter table public.vendor_bill_payments enable row level security;
-- Browser: read-only. Writes only through the service-role bills API.
drop policy if exists vendor_bills_read on public.vendor_bills;
create policy vendor_bills_read on public.vendor_bills for select to authenticated using (true);
drop policy if exists vendor_bill_payments_read on public.vendor_bill_payments;
create policy vendor_bill_payments_read on public.vendor_bill_payments for select to authenticated using (true);
grant select on public.vendor_bills, public.vendor_bill_payments to authenticated;
grant select, insert, update on public.vendor_bills, public.vendor_bill_payments to service_role;

-- VERIFICATION
select '1. vendor_bills' as check_name,
       case when to_regclass('public.vendor_bills') is not null then '✅ exists' else '❌ MISSING' end as result
union all
select '2. vendor_bill_payments',
       case when to_regclass('public.vendor_bill_payments') is not null then '✅ exists' else '❌ MISSING' end;
