-- =====================================================================
-- v55.81 QA-17 — Crisis-language flag on hr_complaints
-- =====================================================================
-- When a user files an HR concern containing language that suggests
-- self-harm, threat, or severe distress (heuristic match in
-- src/lib/crisis-detection.js), we tag the row so admins see it
-- elevated and so we can surface professional resources to the user.
--
-- Values:
--   self_harm  - explicit self-harm or suicidal language
--   threat     - threats from others, fear for safety
--   distress   - severe distress signals short of self_harm
--   NULL       - no flag (default; vast majority of submissions)
-- =====================================================================

ALTER TABLE hr_complaints
  ADD COLUMN IF NOT EXISTS crisis_flag TEXT
    CHECK (crisis_flag IS NULL OR crisis_flag IN ('self_harm', 'threat', 'distress'));

CREATE INDEX IF NOT EXISTS idx_hr_complaints_crisis_flag
  ON hr_complaints(crisis_flag)
  WHERE crisis_flag IS NOT NULL;

COMMENT ON COLUMN hr_complaints.crisis_flag IS 'v55.81 QA-17: heuristic crisis-language flag set at submission time. NULL for the vast majority. self_harm > threat > distress in severity. Surfaces resources to the user and elevates urgency for admins.';
