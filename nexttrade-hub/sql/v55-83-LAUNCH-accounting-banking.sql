-- ============================================================================
-- v55.83 LAUNCH — Accounting / Banking go-live migration (ONE script)
-- Combines: HE (bank_transaction_splits Wave columns) + HI (production push unlock)
--
-- SAFE: additive + idempotent. Adds columns only; modifies NO existing data.
-- Run once in the Supabase SQL editor (Database -> SQL editor -> paste -> Run),
-- or via psql. Re-running is harmless.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) HE — Wave category columns on bank_transaction_splits
--    Needed so a split-line Wave categorization saves with full Wave metadata.
--    (App already has a fallback so split-save won't crash without this, but
--    running it makes split Wave categories persist properly.)
-- ---------------------------------------------------------------------------
alter table if exists bank_transaction_splits
  add column if not exists wave_business_id   text,
  add column if not exists wave_account_id    text,
  add column if not exists wave_account_name  text,
  add column if not exists category_source    text,
  add column if not exists category_status    text;

create index if not exists idx_bts_pending_wave_sync
  on bank_transaction_splits (category_status)
  where category_status = 'pending_wave_sync';

-- ---------------------------------------------------------------------------
-- 2) HI — super-admin "enable real production Wave push" switch
--    Master switch a super admin flips (in Wave Sync Center -> Settings) to allow
--    REAL production Wave pushes for a business, AFTER testing on the test silo.
--    Default FALSE = locked (today's behavior). Production push also still requires
--    writes_enabled + the per-action allow_*_push flags + the push permission.
-- ---------------------------------------------------------------------------
alter table if exists wave_business_registry
  add column if not exists production_push_unlocked boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3) (Optional) Verify — run these SELECTs to confirm the columns exist.
-- ---------------------------------------------------------------------------
-- select column_name from information_schema.columns
--   where table_name = 'bank_transaction_splits'
--     and column_name in ('wave_business_id','wave_account_id','wave_account_name','category_source','category_status')
--   order by column_name;
--
-- select wave_business_id, label, is_production, writes_enabled,
--        allow_customer_push, allow_invoice_push, allow_payment_push, production_push_unlocked
--   from wave_business_registry
--   order by is_production, label;
