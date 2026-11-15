-- v55.83-MC — per-account single-writer ownership flag (the anti-duplicate firewall).
-- Each Wave bank/cash account is owned by exactly ONE feeder: the Hub (Wave's own bank feed OFF for it →
-- the Hub creates categorized transactions) or Wave's bank feed (Hub must NOT create → would duplicate).
-- NULL/unset = blocked by default until an owner is chosen, so a newly added account never silently dupes.
-- Lives on wave_categories because push-transaction already reads that table to resolve the bank side.
ALTER TABLE wave_categories
  ADD COLUMN IF NOT EXISTS wave_feed_owner text;

-- Constrain to the two valid owners (NULL allowed = unset = blocked). Drop+recreate so re-running is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'wave_categories' AND constraint_name = 'wave_categories_feed_owner_chk'
  ) THEN
    ALTER TABLE wave_categories
      ADD CONSTRAINT wave_categories_feed_owner_chk
      CHECK (wave_feed_owner IS NULL OR wave_feed_owner IN ('HUB','WAVE_FEED'));
  END IF;
END $$;
