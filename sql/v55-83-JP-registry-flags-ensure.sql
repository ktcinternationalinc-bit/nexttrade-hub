-- v55.83-JP — GUARANTEE every Wave production-push flag column exists on wave_business_registry.
-- WHY: the "Enable real production Wave push" toggle loops back OFF when the underlying column is
-- missing on the live DB — the service-role write then errors/no-ops and the switch can never stick.
-- This consolidates HI + the launch flags into ONE idempotent, additive file. Run it once in the
-- Supabase SQL editor. No data is modified (every column defaults to false = locked, today's behavior).
--
-- Safety model (enforced in BOTH the UI and the server push routes): a PRODUCTION business receives a
-- real Wave write ONLY when production_push_unlocked = true AND writes_enabled = true AND the matching
-- allow_<action>_push = true. Test businesses (is_production = false) are unaffected.

alter table if exists wave_business_registry
  add column if not exists production_push_unlocked boolean not null default false,
  add column if not exists writes_enabled           boolean not null default false,
  add column if not exists allow_customer_push       boolean not null default false,
  add column if not exists allow_invoice_push        boolean not null default false,
  add column if not exists allow_payment_push        boolean not null default false,
  add column if not exists allow_auto_push           boolean not null default false;

-- Make sure no leftover RLS or trigger reverts the flag for the service role. (The save goes through
-- the service-role route /api/wave/registry-flags, which bypasses RLS; this is belt-and-suspenders.)
-- If a BEFORE UPDATE trigger on wave_business_registry is forcing these columns back to false, find it:
--   select tgname, tgrelid::regclass from pg_trigger where tgrelid = 'wave_business_registry'::regclass;
-- and drop/disable the offending trigger.

-- Confirm the current state after running:
-- select wave_business_id, label, is_production, production_push_unlocked, writes_enabled,
--        allow_customer_push, allow_invoice_push, allow_payment_push, allow_auto_push
-- from wave_business_registry order by is_production, label;
