-- S22 (Apr 23 2026) — Optional columns used by the Close Ticket flow.
--
-- The app now gracefully falls back if these don't exist, but adding them
-- means "closed by / closed at" will be stamped directly on the ticket
-- row (in addition to living in the closing comment). Nicer for audits
-- and for the ticket detail header.
--
-- Safe to run multiple times.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID;

SELECT 'tickets.closed_at + closed_by ready' AS status,
  count(*) FILTER (WHERE closed_at IS NOT NULL) AS rows_with_closed_at
FROM tickets;
