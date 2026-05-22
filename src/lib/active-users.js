// ============================================================
// active-users.js — single source of truth for "is this user active"
//
// Why this exists: prior to v55.62 we had `u.active !== false` scattered
// across 11 files. Problem: that test ALSO returns true when active is
// NULL or undefined. Some legacy users in the DB have active=NULL after
// being deactivated through an old code path; they were still showing on
// the admin scorecard, in the team dropdowns, etc. — wrong.
//
// New rule (codified here and used everywhere):
//   - active === true      → active
//   - active === undefined → active (legacy rows that never had the column)
//   - active === null      → INACTIVE (was being treated as active before)
//   - active === false     → INACTIVE (the obvious case)
//
// Use isActiveUser(u) for a single check, or filterActiveUsers(arr) for
// an array filter.
// ============================================================

export function isActiveUser(u) {
  if (!u) return false;
  if (u.active === false) return false;
  if (u.active === null) return false;
  return true;
}

export function filterActiveUsers(users) {
  if (!Array.isArray(users)) return [];
  return users.filter(isActiveUser);
}
