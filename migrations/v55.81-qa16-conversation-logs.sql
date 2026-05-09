-- =====================================================================
-- v55.81 QA-16 — Server-side conversation log for cross-device continuity
-- =====================================================================
-- Problem: Per the whitepaper, Nadia/Jenna/Sara conversation messages were
-- stored only in the user's browser localStorage. When a user switched
-- from phone to laptop, history started empty — Nadia "forgot" what they
-- said yesterday. The 80-message rolling trim further compounded amnesia
-- for power users.
--
-- Fix: persist a tail of each conversation server-side, keyed by user
-- and persona. The client still uses localStorage as the primary cache
-- (fast, offline-tolerant), and on cold load reconciles with the server
-- — server wins if there's a discrepancy.
--
-- Schema design notes:
--   - One row per user per persona (3 rows max per user). Updated in
--     place rather than appending — avoids unbounded growth.
--   - The `messages` JSON holds an array of {role, content, ts} entries.
--     Trimmed server-side to last 80 messages (matches the localStorage
--     trim) to bound row size at ~50KB per user per persona.
--   - `last_persisted_at` lets the client detect when the server has
--     newer state than its local cache (e.g. fresh device).
--   - RLS will be added in a follow-up migration. For now this is a
--     server-side-only table — only the service role writes/reads.
-- =====================================================================

CREATE TABLE IF NOT EXISTS conversation_logs (
  user_id      UUID NOT NULL,
  persona      TEXT NOT NULL CHECK (persona IN ('nadia', 'jenna', 'sara')),
  messages     JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_count INT NOT NULL DEFAULT 0,
  last_persisted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, persona)
);

CREATE INDEX IF NOT EXISTS idx_conversation_logs_user ON conversation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_recent ON conversation_logs(last_persisted_at DESC);

COMMENT ON TABLE conversation_logs IS
  'v55.81 QA-16: server-side persistence of per-persona conversation tail. ' ||
  'Backs cross-device continuity. Trimmed to 80 messages per persona per user.';

COMMENT ON COLUMN conversation_logs.messages IS
  'Array of {role: "user"|"assistant", content: text, ts: ISO datetime}. ' ||
  'Capped at 80 entries (matches client localStorage trim).';
