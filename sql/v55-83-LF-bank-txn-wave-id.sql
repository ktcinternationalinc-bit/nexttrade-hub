-- v55.83-LF — add the bank_transactions.wave_transaction_id column the transaction-push (KZ/LE) writes.
-- The push route writes this id on a successful moneyTransactionCreate, but no migration ever declared
-- the column, so the route had to write it inside a try/fallback and the blotter mirror could not read it.
-- This makes the Wave transaction id a first-class, indexed column so the mirror badge can show
-- "✓ Wave txn" reliably and a re-push is idempotent on the Hub side too.
-- Safe to re-run.

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS wave_transaction_id text;
CREATE INDEX IF NOT EXISTS ix_bt_wave_txn_id ON bank_transactions (wave_transaction_id);

-- (Optional, documents intent) category_source values in use:
--   'classification' = categorized in the Hub
--   'wave'           = reflected from Wave (push round-trip)
--   'wave_csv'       = imported from Wave's CSV export (Wave-UI categorization)
COMMENT ON COLUMN bank_transactions.wave_transaction_id IS 'Wave moneyTransaction id from a successful push (v55.83-LF). Null until pushed.';
