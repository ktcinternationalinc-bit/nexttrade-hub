create table if not exists public.nextrade_ktc_pnl_exclusions (
  transaction_id uuid primary key references public.bank_transactions(id) on delete cascade,
  excluded boolean not null,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);

alter table public.nextrade_ktc_pnl_exclusions enable row level security;
revoke all on public.nextrade_ktc_pnl_exclusions from public, anon, authenticated;
grant select, insert, update on public.nextrade_ktc_pnl_exclusions to service_role;
