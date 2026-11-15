-- v55.82-W — Diagnose / fix the "can't change ticket to Critical" bug.
-- Max reported May 12 2026: changing a ticket's priority from any value
-- to 'critical' silently fails. The frontend code calls dbUpdate with
-- { priority: 'critical' } and treats success/error normally. The most
-- likely cause is a CHECK constraint on tickets.priority that doesn't
-- include 'critical' — same pattern as the container_type fix from earlier.
--
-- STEP 1 — see what the current constraint allows.
-- Run this first and paste the output:

SELECT conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid = 'public.tickets'::regclass
  AND c.contype = 'c'
  AND conname LIKE '%priority%';

-- STEP 2 — also see what priority values exist in your data right now,
-- so we know we won't break any row with a tighter/looser constraint:

SELECT priority, COUNT(*) AS row_count
FROM tickets
GROUP BY priority
ORDER BY row_count DESC;

-- STEP 3 — Based on the output, run ONE of the two paths:
--
-- PATH A (constraint exists and doesn't include 'critical'):
--   ALTER TABLE tickets DROP CONSTRAINT <constraint_name_from_step_1>;
--   ALTER TABLE tickets ADD CONSTRAINT tickets_priority_check
--     CHECK (priority IS NULL OR priority IN ('critical','high','medium','low'));
--
-- PATH B (no constraint exists — bug is elsewhere):
--   Send me a screenshot of the browser console (F12) when you try to
--   change a ticket to Critical. I'll look for the dbUpdate error there.
