-- v55.83-JR — Plaid gap-free incremental sync + backfill control (Codex launch FAIL).
-- Adds per-connection markers so normal Sync pulls FORWARD from the last successful point (not the UI
-- date window), pages past 500, and an admin can choose how far back to backfill on connect/re-link.
-- Idempotent, additive. No transactions/matches are touched.

alter table if exists bank_connections
  -- how far back the admin chose to backfill on first connect / re-link (null = default 30d)
  add column if not exists initial_backfill_start_date date,
  -- newest posted_date successfully ingested for this connection (incremental cursor for /transactions/get)
  add column if not exists last_successful_posted_date date,
  -- when the last successful sync completed
  add column if not exists last_successful_plaid_sync_at timestamptz,
  -- reserved for migrating to /transactions/sync (cursor-based); stored only after DB writes succeed
  add column if not exists plaid_cursor text;

-- Confirm:
-- select id, name, wave_business_id, initial_backfill_start_date, last_successful_posted_date,
--        last_successful_plaid_sync_at, plaid_cursor, last_synced, last_sync_status
-- from bank_connections order by last_synced desc nulls last;
