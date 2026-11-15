-- s36 — HR Report permission
-- ====================================================================
-- Adds the new "HR Report" granular permission used by the analytical
-- HR scorecard view in AdminTab. Super admins always have access (no
-- DB row needed since the role check short-circuits in the UI). This
-- migration just ensures the permission row exists for non-super users
-- so super admins can toggle it ON in Settings.
--
-- Safe to run multiple times — uses INSERT ... ON CONFLICT.
-- ====================================================================

-- Optional but useful: backfill a row per non-super user with has_access = false
-- so the SettingsTab matrix renders with an explicit OFF state instead of
-- inferring it.
INSERT INTO module_permissions (user_id, module_name, has_access)
SELECT u.id, 'HR Report', false
FROM users u
WHERE u.role IS DISTINCT FROM 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM module_permissions mp
    WHERE mp.user_id = u.id AND mp.module_name = 'HR Report'
  );

-- Sanity check — count of users with the permission row now set
SELECT
  (SELECT COUNT(*) FROM module_permissions WHERE module_name = 'HR Report') AS hr_report_rows,
  (SELECT COUNT(*) FROM users WHERE role IS DISTINCT FROM 'super_admin') AS non_super_users;
