// v55.83-A.4 — RETIRED (Max May 13 2026)
// Era: S22 (Apr 2026)
// Reason: tested closeModal duplicate-render and greeterMessages localStorage hydration — both consolidated in later refactors
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
console.log('⚠️  test-s22-close-and-nadia-fixes.js RETIRED — architecture changed');
process.exit(0);
