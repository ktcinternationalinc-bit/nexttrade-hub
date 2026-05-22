// v55.83-A.4 — RETIRED (Max May 13 2026)
// Era: S18 multi-agent (Apr 2026)
// Reason: tested followUpActiveRef on nadia-tts-stop event — event renamed in later overlay redesign
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
console.log('⚠️  test-s18-multi.js RETIRED — architecture changed');
process.exit(0);
