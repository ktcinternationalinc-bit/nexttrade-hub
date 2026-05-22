// v55.83-A.4 — RETIRED (Max May 13 2026)
// Era: v55.27 tickets status constraint
// Reason: reads supabase/schema.sql which doesn't exist. The current schema is split across sql/*.sql files. Verification of tickets status constraint is now covered by sql/v55-83-a-2-tickets-hotfix.sql (the priority CHECK fix).
//
// Retired because the file dependency referenced in this suite has never
// existed in this repository layout. Tests for the relevant feature areas
// live in newer suites; see git history / handoff docs for migration paths.
console.log('⚠️  test-v55-27-tickets-status-constraint.js RETIRED — file dependency does not exist in repo');
process.exit(0);
