-- s37 — Backfill orphan series_id on recurring events
-- ====================================================================
-- Some recurring calendar_events may have ended up with series_id = NULL
-- due to legacy data, a failed migration, or a creation race condition.
-- When that happens, the picker that lets you cancel/delete "all in series"
-- can't find sibling rows, so "delete all" only deletes the one row the
-- user is looking at. This migration repairs the linkage by grouping
-- orphan recurring rows on the heuristic key (title, recurring,
-- created_by, recurrence_interval) and assigning each group a fresh
-- series_id, plus marking the earliest row of each group as the master.
--
-- Idempotent — safe to run multiple times. Only touches rows where
-- series_id IS NULL.
-- ====================================================================

-- Safety backup
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_events') THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS calendar_events_backup_s37 AS SELECT * FROM calendar_events';
  END IF;
END $$;

-- Group orphans into synthetic series. Each unique combination of
-- (title, recurring, created_by, recurrence_interval) becomes one series.
WITH groups AS (
  SELECT
    title,
    recurring,
    created_by,
    COALESCE(recurrence_interval, 1) AS recurrence_interval,
    gen_random_uuid() AS new_series_id,
    MIN(event_date) AS first_date
  FROM calendar_events
  WHERE series_id IS NULL
    AND recurring IS NOT NULL
    AND recurring <> 'none'
  GROUP BY title, recurring, created_by, COALESCE(recurrence_interval, 1)
  HAVING COUNT(*) >= 2  -- only groups with 2+ rows count as a series
)
UPDATE calendar_events ce
SET series_id = g.new_series_id
FROM groups g
WHERE ce.series_id IS NULL
  AND ce.title = g.title
  AND ce.recurring = g.recurring
  AND COALESCE(ce.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(g.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
  AND COALESCE(ce.recurrence_interval, 1) = g.recurrence_interval;

-- Mark the earliest event of each newly-linked series as the master.
WITH firsts AS (
  SELECT DISTINCT ON (series_id) id
  FROM calendar_events
  WHERE series_id IN (
    SELECT DISTINCT series_id FROM calendar_events
    WHERE series_id IS NOT NULL
      AND is_series_master IS NULL OR is_series_master = false
  )
  ORDER BY series_id, event_date ASC, created_at ASC
)
UPDATE calendar_events ce
SET is_series_master = true
FROM firsts f
WHERE ce.id = f.id
  AND (ce.is_series_master IS NULL OR ce.is_series_master = false);

-- Sanity report
SELECT
  (SELECT COUNT(*) FROM calendar_events WHERE series_id IS NULL AND recurring IS NOT NULL AND recurring <> 'none') AS still_orphan_recurring,
  (SELECT COUNT(DISTINCT series_id) FROM calendar_events WHERE series_id IS NOT NULL) AS distinct_series,
  (SELECT COUNT(*) FROM calendar_events WHERE is_series_master = true) AS master_rows;
