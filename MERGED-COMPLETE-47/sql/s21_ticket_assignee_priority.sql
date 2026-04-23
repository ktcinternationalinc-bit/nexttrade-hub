-- S21 (Apr 23 2026) — Priority Board.
--
-- Adds assignee_priority: integer rank within a person's ticket stack.
-- 1 = top priority (what they're working on right now).
-- NULL = not yet ranked (sits under the ranked tickets in the board).
--
-- This is ADDITIVE to the existing `priority` field (high/medium/low) —
-- that one captures business urgency; this one captures personal work order.
--
-- Safe to run multiple times.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assignee_priority INTEGER;

-- Index for fast ordering within a person's column on the board
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_priority
  ON tickets (assigned_to, assignee_priority)
  WHERE assignee_priority IS NOT NULL;

SELECT 'tickets.assignee_priority ready' AS status,
  count(*) FILTER (WHERE assignee_priority IS NOT NULL) AS already_ranked
FROM tickets;
