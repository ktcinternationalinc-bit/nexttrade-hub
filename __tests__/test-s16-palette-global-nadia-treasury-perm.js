// v55.83-A.4 — RETIRED (Max May 13 2026)
// Era: S16 (Apr 2026)
// Reason: tested pre-overhaul Nadia palette, overlay positioning (now redesigned), and tickets-priority color mapping (now in dashboard not TicketsTab)
//
// The current architecture (post-overhaul Nadia overlay, consolidated AI
// surface, redesigned event protocol) renders the assertions in this suite
// structurally invalid. Not a bug in code — the test is asserting an
// architecture that was deliberately replaced.
//
// If underlying functionality regresses, the current sweep will catch it
// via test-v55-82-f-nadia-treasury-overlap.js (Nadia overlay), the hooks-
// rule regression scanner, or architecture-current tests for the relevant
// subsystem.
console.log('⚠️  test-s16-palette-global-nadia-treasury-perm.js RETIRED — architecture changed');
process.exit(0);
