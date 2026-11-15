-- v55.83-JE — ADMIN HISTORY-VISIBILITY WINDOW
-- Stores the org-wide policy for how far back NORMAL users may see accounting history.
-- Super-admins always bypass it and see all history.
--
-- IMPORTANT COMPATIBILITY NOTE:
-- Older NextTrade tables already use app_settings(setting_key, setting_value).
-- The visibility route uses app_settings(key, value). This migration keeps BOTH shapes in sync so
-- existing settings such as inventory_cutoff_date keep working and Accounting Visibility can save.

create table if not exists app_settings (
  id            uuid primary key default gen_random_uuid(),
  setting_key   text,
  setting_value text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  key           text,
  value         jsonb not null default '{}'::jsonb,
  updated_by    uuid
);

-- If app_settings already existed, add whichever columns are missing.
alter table app_settings add column if not exists setting_key   text;
alter table app_settings add column if not exists setting_value text;
alter table app_settings add column if not exists key           text;
alter table app_settings add column if not exists value         jsonb default '{}'::jsonb;
alter table app_settings add column if not exists updated_by    uuid;
alter table app_settings add column if not exists updated_at    timestamptz default now();

-- Keep the old and new key/value columns aligned for existing rows.
update app_settings
set key = setting_key
where key is null and setting_key is not null;

update app_settings
set setting_key = key
where setting_key is null and key is not null;

-- The API route uses upsert(onConflict:'key'); older settings screens use setting_key.
create unique index if not exists app_settings_key_uidx on app_settings (key);
create unique index if not exists app_settings_setting_key_uidx on app_settings (setting_key);

-- Seed/repair the visibility row without violating older NOT NULL constraints on setting_key/setting_value.
do $$
declare
  v_key text := 'accounting_visibility_window';
  v_json jsonb := '{"window":"all","customDays":null,"customFrom":null}'::jsonb;
begin
  if exists (select 1 from app_settings where key = v_key or setting_key = v_key) then
    update app_settings
       set key = v_key,
           setting_key = v_key,
           value = coalesce(value, v_json),
           setting_value = coalesce(setting_value, v_json::text),
           updated_at = now()
     where key = v_key or setting_key = v_key;
  else
    insert into app_settings (key, value, setting_key, setting_value, updated_at)
    values (v_key, v_json, v_key, v_json::text, now());
  end if;
end $$;

-- Reads happen via the service-role server route (/api/admin/visibility).
-- The route enforces super-admin for writes.
alter table app_settings disable row level security;
