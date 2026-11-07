-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PQ — CATEGORY → WAVE ACCOUNT LINK (Max, Nov 7: "do this if possible"
-- on: one click categorizes the expense in all three places at once — hub
-- category + ClickBooks (via the map) + Wave (via its account)).
--
-- Adds an OPTIONAL Wave account to each expense category. When a human picks
-- a category whose Wave account is set, the transaction's Wave category rides
-- along automatically (pending_wave_sync) — unless the transaction already
-- has one, which is never overwritten. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS wave_account_id text;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS wave_account_name text;
SELECT 'v55.83-PQ category wave link installed' AS status;

-- ── Transfer pairing (Max, Nov 7 05:05: "category for a transfer between
-- accounts and to associate them to the transfer between accounts including
-- to credit cards") — the two legs of one transfer share a group id, so they
-- are shown as ONE move of money, not income + expense. Idempotent.
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS transfer_group_id uuid;
CREATE INDEX IF NOT EXISTS bank_txn_transfer_group_ix ON bank_transactions (transfer_group_id) WHERE transfer_group_id IS NOT NULL;
SELECT 'v55.83-PQ transfer pairing installed' AS status;
