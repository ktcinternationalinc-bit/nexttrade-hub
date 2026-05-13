// v55.83-A.4 — RETIRED (Max May 13 2026)
// This suite tested supabase/system-tickets-setup.sql which was the v55.59
// initial system_tickets table definition. That file has since been
// superseded by sql/s40_system_tickets_retest.sql (the current canonical
// system_tickets schema). The old file is no longer in the repo.
//
// Reason for retirement: file-existence check + every assertion about its
// contents is invalid by design. The replacement schema is verified by
// test-s40-system-tickets.js (different file, different schema).
//
// If you need to re-test the schema, add assertions to test-s40 instead.
console.log('⚠️  test-v55-59-system-tickets-fix RETIRED — schema moved to s40');
process.exit(0);
