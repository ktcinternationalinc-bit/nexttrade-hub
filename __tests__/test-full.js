// v55.83-A.4 — RETIRED (Max May 13 2026)
// Era: test-full mega-suite
// Reason: looks for supabase/meeting-notes.sql which doesn't exist in this repo — the repo uses sql/ not supabase/ for migrations. This 1430-assertion suite never ran successfully here.
//
// Retired because the file dependency referenced in this suite has never
// existed in this repository layout. Tests for the relevant feature areas
// live in newer suites; see git history / handoff docs for migration paths.
console.log('⚠️  test-full.js RETIRED — file dependency does not exist in repo');
process.exit(0);
