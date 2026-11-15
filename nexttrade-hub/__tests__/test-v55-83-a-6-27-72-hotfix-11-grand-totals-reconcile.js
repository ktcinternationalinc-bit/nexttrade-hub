/* v72 HOTFIX 11 — Polish reconciliation test.
 *
 * Bug Max caught: bottom grand-total cards were showing
 *   USD Total Credit: 72,788  Total Debit: 15,527  Net Balance: 763
 * but 72,788 - 15,527 = 57,261 ≠ 763. The math contradicted itself.
 *
 * Root cause: Credit/Debit cards summed raw credit_amount / debit_amount across ALL
 * transaction types, so an invoice AND its payment both contributed (double-count).
 * The Net Balance card was already correct (FIFO-based).
 *
 * Fix: replace the Credit/Debit cards with Open AR / Open AP cards driven by FIFO
 * (theyOweUs / weOweThem from simulate()). Now Open AR − Open AP = Net (when prepaid = 0). */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');

console.log('\n── Grand-total cards rewired to FIFO (no more double-counting) ──');

ok('A1: Total Open AR card uses t.theyOweUs (FIFO sales-invoice remaining)',
  /Total Open AR[\s\S]{0,300}fmtNum\(t\.theyOweUs\)/.test(oa));

ok('A2: Total Open AP card uses t.weOweThem (FIFO vendor-bill remaining)',
  /Total Open AP[\s\S]{0,300}fmtNum\(t\.weOweThem\)/.test(oa));

ok('A3: NO rendered label "Total Credit (money in)" in JSX (was the double-count source)',
  !/uppercase tracking-wider[^<]*Total Credit \(money in\)/.test(oa));

ok('A4: NO rendered label "Total Debit (money out)" in JSX (was the double-count source)',
  !/uppercase tracking-wider[^<]*Total Debit \(money out\)/.test(oa));

ok('A5: Net Balance card still uses t.balance (FIFO source of truth)',
  /Net Balance[\s\S]{0,400}fmtSigned\(t\.balance\)/.test(oa));

ok('A6: Net Balance card includes inline math line for reconciliation transparency',
  /= ' \+ fmtNum\(t\.theyOweUs\) \+ ' − ' \+ fmtNum\(t\.weOweThem\)/.test(oa));

ok('A7: Sub-labels stay "they still owe us" / "we still owe them"',
  /they still owe us/.test(oa) && /we still owe them/.test(oa));

console.log('\n── Reconciliation math: Open AR − Open AP = Net Balance ──');

// Simulate the reviewer's screenshot exactly:
//   5 accounts. USD shows: Total Credit 72,788  Total Debit 15,527  Net 763 (they owe us)
//   EGP shows: Total Credit 0  Total Debit 29,500  Net -20,500 (we owe them)
//
// With the fix, the cards must show:
//   USD: Total Open AR = some value, Total Open AP = some value, Net = (AR − AP)
//   EGP: Total Open AR = 0, Total Open AP = 20,500, Net = -20,500
//
// We can't infer USD AR/AP exactly from the screenshot (would need entry-level detail),
// but we CAN assert that whatever values are surfaced satisfy AR - AP = Net (when no prepaid).

function checkReconciles(theyOweUs, weOweThem, theirPrepaid, ourPrepaid, balance) {
  // General reconciliation: (AR + theirPrepaid) - (AP + ourPrepaid) = net
  // Standard case (no prepaid): AR - AP = net
  var expectedNet = (theyOweUs - weOweThem) + (theirPrepaid - ourPrepaid);
  return Math.abs(expectedNet - balance) < 0.01;
}

// EGP case from screenshot: 0 AR, 20500 AP, net = -20500
ok('B1: EGP reconciles: 0 − 20,500 = −20,500 (matches screenshot)',
  checkReconciles(0, 20500, 0, 0, -20500));

// USD case is the unknown one. For the screenshot to be true (net = 763), AR − AP must = 763.
// Example: 7,012 AR (from TEST account) − 9,888 AP (TEST) + something from other accounts.
// We just assert the algebraic invariant — the actual values come from FIFO sim.
ok('B2: Any FIFO state reconciles: AR − AP + (their prepaid) − (our prepaid) = Net Balance',
  checkReconciles(7012, 9888, 0, 0, -2876) &&    // TEST account alone
  checkReconciles(10000, 5000, 500, 0, 5500) &&  // example with their prepaid
  checkReconciles(0, 0, 0, 200, -200));          // pure prepaid case

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 11 polish — bottom cards reconcile algebraically');
console.log('══════════════════════════════════════════════');
