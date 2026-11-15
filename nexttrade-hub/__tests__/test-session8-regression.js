// v55.83-A.4 — RETIRED (Max May 13 2026)
// Era: session8 regression
// Reason: reads vercel.json which doesn't exist (deployment uses Vercel project config in the dashboard, not vercel.json)
//
// Retired because the file dependency referenced in this suite has never
// existed in this repository layout. Tests for the relevant feature areas
// live in newer suites; see git history / handoff docs for migration paths.
console.log('⚠️  test-session8-regression.js RETIRED — file dependency does not exist in repo');
process.exit(0);
