-- v55.83-JE — ADMIN HISTORY-VISIBILITY WINDOW
-- Stores the org-wide policy for how far back NORMAL users may see history (Bank Review, BankTab,
-- Invoices, AR, Customer Ledger, Open Accounts). Super-admins always bypass it and see all history.
-- A simple key/value settings table so we can add future org settings without new migrations.

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

-- Seed the visibility window (default: all history, i.e. no restriction until an admin sets one).
insert into app_settings (key, value)
values ('accounting_visibility_window', '{"window":"all","customDays":null,"customFrom":null}')
on conflict (key) do nothing;

-- Reads happen via the service-role server route (/api/admin/visibility); keep RLS off or open here.
-- The route enforces super-admin for WRITES in code.
alter table app_settings disable row level security;
