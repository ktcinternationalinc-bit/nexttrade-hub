/* v72 HOTFIX 27 — SUPERSEDED BY HOTFIX 32.
 *
 * HOTFIX 27 reverted HOTFIX 26 because the drain-the-pool behavior caused
 * phantom payments. HOTFIX 28 later identified the real root cause: 4
 * corrupt offset rows (vendor_bill ↔ vendor_bill pairings) that bypassed
 * the simulator's type contract. HOTFIX 28 added type-checking that rejects
 * those corrupt rows at simulator time.
 *
 * With HOTFIX 28's defenses in place, the drain behavior is structurally
 * safe — there's no path for a credit_adjustment drain to feed phantom
 * payments into a downstream offset row. So HOTFIX 32 re-enables the drain
 * (chronological consistency: credit_adjustment that exists ON THE SAME DAY
 * as a vendor bill should pay it down immediately, not get parked while a
 * future sales invoice gets cannibalized).
 *
 * This file kept as a tombstone so the timeline is readable. The actual
 * regression guards for HOTFIX 32 behavior live in
 * test-v55-83-a-6-27-72-hotfix-32-chronological-credit-adjustment.js
 */
function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

console.log('\n── HOTFIX 27 tombstone (superseded by HOTFIX 32) ──');
ok('TOMBSTONE.1: HOTFIX 27 acknowledged as superseded — see hotfix-32 test for active assertions', true);
console.log('══════════════════════════════════════════════');
console.log('✅ HOTFIX 27 tombstone — superseded by HOTFIX 32 (chronological credit_adjustment)');
console.log('══════════════════════════════════════════════');
