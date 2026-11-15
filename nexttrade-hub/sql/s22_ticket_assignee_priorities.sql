-- S22.5 (Apr 23 2026) — Per-assignee ticket priorities.
--
-- Previously, tickets.assignee_priority was a single integer on the ticket
-- row: one priority number per ticket. That broke down once Max pointed out
-- that tickets often have multiple owners (primary `assigned_to` +
-- `additional_assignees`). Each owner needs their OWN priority ordering
-- within their personal column on the Priority Board.
--
-- This table stores (ticket, user) → priority. One row per ticket per
-- assignee. When someone drags a ticket around the board, we update/insert
-- here — never on the tickets row itself.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS ticket_assignee_priorities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  priority INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID,
  UNIQUE (ticket_id, user_id)
);

-- Fast lookup: "everything in person X's ordered column"
CREATE INDEX IF NOT EXISTS idx_tap_user_priority
  ON ticket_assignee_priorities (user_id, priority);

-- Fast lookup: "every priority row for a given ticket" (needed when
-- renumbering after a drag that affects multiple owners)
CREATE INDEX IF NOT EXISTS idx_tap_ticket
  ON ticket_assignee_priorities (ticket_id);

-- RLS: allow-all for now (matches existing pattern on tickets/comments).
-- The app enforces who-can-reorder-whom in the UI/client layer.
DO $$ BEGIN
  ALTER TABLE ticket_assignee_priorities ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow all ticket_assignee_priorities"
    ON ticket_assignee_priorities FOR ALL
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One-time backfill: copy any existing tickets.assignee_priority values
-- into the new table so people don't lose their current rankings.
-- Only inserts if the (ticket, user) pair doesn't already exist.
INSERT INTO ticket_assignee_priorities (ticket_id, user_id, priority, updated_by)
SELECT t.id, t.assigned_to, t.assignee_priority, t.assigned_to
FROM tickets t
WHERE t.assigned_to IS NOT NULL
  AND t.assignee_priority IS NOT NULL
ON CONFLICT (ticket_id, user_id) DO NOTHING;

SELECT 'ticket_assignee_priorities ready' AS status,
  (SELECT count(*) FROM ticket_assignee_priorities) AS rows_after_backfill;
