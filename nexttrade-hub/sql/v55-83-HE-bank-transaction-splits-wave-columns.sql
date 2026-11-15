-- v55.83-HE — Wave category columns on bank_transaction_splits
--
-- Codex QA (HD pass) flagged that BankReviewTab.saveSplits now persists Wave category
-- fields on split rows, and /api/wave/preflight-schema expects them, but no migration in
-- the repo proves the columns exist. This adds them idempotently so a split-line Wave
-- categorization can save without erroring on a missing column.
--
-- Matches the Wave category columns already on bank_transactions (text ids — wave_account_id
-- is a Wave GraphQL id, not a uuid). Safe to run multiple times.
--
-- Run in Supabase SQL editor (or psql). No data is modified; columns are additive.

alter table if exists bank_transaction_splits
  add column if not exists wave_business_id   text,
  add column if not exists wave_account_id    text,
  add column if not exists wave_account_name  text,
  add column if not exists category_source    text,
  add column if not exists category_status    text;

-- Optional: index to find split lines awaiting Wave sync quickly.
create index if not exists idx_bts_pending_wave_sync
  on bank_transaction_splits (category_status)
  where category_status = 'pending_wave_sync';
