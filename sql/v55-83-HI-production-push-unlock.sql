-- v55.83-HI — super-admin production Wave push unlock switch
--
-- Adds production_push_unlocked to wave_business_registry. This is the master switch a
-- super admin flips to allow REAL production Wave pushes for a specific business, AFTER
-- testing on the test silo. Default FALSE = locked (today's exact behavior).
--
-- Safety model (enforced in BOTH the UI and the server routes — push-customer,
-- push-invoice-v2, push-payment):
--   A production business may receive a real push ONLY when ALL are true:
--     production_push_unlocked = true  (super-admin master switch, this column)
--     writes_enabled           = true
--     allow_<action>_push      = true  (allow_customer_push / allow_invoice_push / allow_payment_push)
--   Test business (is_production = false) is unaffected.
--
-- Idempotent and additive. Run in Supabase SQL editor. No data is modified.

alter table if exists wave_business_registry
  add column if not exists production_push_unlocked boolean not null default false;

-- (Optional) confirm current state:
-- select wave_business_id, label, is_production, writes_enabled,
--        allow_customer_push, allow_invoice_push, allow_payment_push, production_push_unlocked
-- from wave_business_registry order by is_production, label;
