-- ============================================================
-- LOGIN EVENTS TABLE
-- Records EVERY login event with UTC timestamp.
-- Day boundaries are calculated in America/New_York (Eastern Time)
-- via PostgreSQL's AT TIME ZONE for queries like "logins today".
-- ============================================================

CREATE TABLE IF NOT EXISTS login_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('login', 'logout', 'heartbeat')),
  -- UTC timestamp of the event
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Pre-computed ET date for fast "today" queries (YYYY-MM-DD in America/New_York)
  et_date     DATE GENERATED ALWAYS AS ((occurred_at AT TIME ZONE 'America/New_York')::date) STORED,
  -- Optional context
  user_agent  TEXT,
  ip_address  TEXT,
  session_id  TEXT,
  notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_events_user_etdate ON login_events(user_id, et_date);
CREATE INDEX IF NOT EXISTS idx_login_events_occurred ON login_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_type ON login_events(event_type);

DO $$ BEGIN ALTER TABLE login_events ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "login_events_all_ops" ON login_events FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Convenience view for the admin portal:
--   - last_login_at  : most recent 'login' event
--   - last_seen_at   : most recent event of any type (login, logout, heartbeat)
--   - logins_today_et: count of 'login' events in today (Eastern Time)
--   - logins_yesterday_et: count of 'login' events yesterday (ET)
CREATE OR REPLACE VIEW user_login_summary AS
WITH today_et AS (
  SELECT (NOW() AT TIME ZONE 'America/New_York')::date AS et_today
),
agg AS (
  SELECT
    le.user_id,
    MAX(CASE WHEN le.event_type = 'login' THEN le.occurred_at END) AS last_login_at,
    MAX(le.occurred_at) AS last_seen_at,
    COUNT(*) FILTER (WHERE le.event_type = 'login' AND le.et_date = (SELECT et_today FROM today_et)) AS logins_today_et,
    COUNT(*) FILTER (WHERE le.event_type = 'login' AND le.et_date = ((SELECT et_today FROM today_et) - INTERVAL '1 day')) AS logins_yesterday_et,
    COUNT(*) FILTER (WHERE le.event_type = 'login' AND le.et_date >= ((SELECT et_today FROM today_et) - INTERVAL '7 days')) AS logins_last_7d_et
  FROM login_events le
  GROUP BY le.user_id
)
SELECT
  u.id,
  u.name,
  u.full_name,
  u.role,
  agg.last_login_at,
  agg.last_seen_at,
  COALESCE(agg.logins_today_et, 0) AS logins_today_et,
  COALESCE(agg.logins_yesterday_et, 0) AS logins_yesterday_et,
  COALESCE(agg.logins_last_7d_et, 0) AS logins_last_7d_et,
  -- Online status: heartbeat or activity within last 10 minutes
  (agg.last_seen_at IS NOT NULL AND agg.last_seen_at > NOW() - INTERVAL '10 minutes') AS is_online
FROM users u
LEFT JOIN agg ON agg.user_id = u.id
ORDER BY u.name;

-- Verification
SELECT 'login_events table' AS what, COUNT(*) AS rows FROM login_events
UNION ALL
SELECT 'user_login_summary view rows', COUNT(*) FROM user_login_summary;
