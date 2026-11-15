// v55.83-A.4 — RETIRED (Max May 13 2026)
// Era: S17.6 (Apr 2026)
// Reason: tested doSpeak /api/tts request shape + nadia-tts-start event names that have since been renamed/restructured
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
console.log('⚠️  test-s17-6-tab-greeting-tts-always-on.js RETIRED — architecture changed');
process.exit(0);
