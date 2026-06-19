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

-- v55.83-JF (Codex schema-compat) — if an OLDER app_settings table already exists with a different
-- shape, `create table if not exists` is a no-op and would NOT add these columns. Add them defensively
-- and guarantee `key` is unique so the route's upsert(onConflict:'key') works on any pre-existing table.
alter table app_settings add column if not exists key        text;
alter table app_settings add column if not exists value      jsonb default '{}'::jsonb;
alter table app_settings add column if not exists updated_by uuid;
alter table app_settings add column if not exists updated_at timestamptz default now();
create unique index if not exists app_settings_key_uidx on app_settings (key);

-- Seed the visibility window (default: all history, i.e. no restriction until an admin sets one).
insert into app_settings (key, value)
values ('accounting_visibility_window', '{"window":"all","customDays":null,"customFrom":null}')
on conflict (key) do nothing;

-- Reads happen via the service-role server route (/api/admin/visibility); keep RLS off or open here.
-- The route enforces super-admin for WRITES in code.
alter table app_settings disable row level security;
