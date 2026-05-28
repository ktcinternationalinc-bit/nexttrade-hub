/* v72 HOTFIX 27 — REVERTS v72 HOTFIX 26.
 *
 * HOTFIX 26 made `credit_adjustment` drain open invoices/bills first
 * (the same way `payment_sent` and `payment_received` do). Intent was
 * to fix per-row Open Balance display: credits were being parked in
 * the prepaid pool right next to open bills, inflating both numbers
 * in ways that cancelled at the summary level but lied per-row.
 *
 * The fix made things measurably worse in production:
 *   - Vendor bills got marked "✓ paid" with no credit pool to back it up
 *   - Summary widgets ("They owe us 76,366 EGP") actively contradicted
 *     Running Balance ("We owe them 968,914 EGP")
 *   - Per-row Open Balance no longer matched Running Balance
 *
 * Best guess at root cause: the FIFO ordering across types interacts
 * in ways that need real entry data to reason about correctly. A
 * credit_adjustment can come BEFORE or AFTER the bills it relates to,
 * and draining open pools at the wrong moment cascades downstream into
 * later transactions and inflates `applied[bill.id]` past the bill's
 * actual amount.
 *
 * Decision per Max May 28 2026 + cross-checked with Gemini:
 * REVERT HOTFIX 26, ship as HOTFIX 27, wait for real Supabase data
 * before attempting another fix.
 *
 * This test exists so I can't accidentally re-introduce HOTFIX 26
 * thinking it was a missing feature. It ASSERTS the direct-park
 * behavior and ASSERTS the phantom-paid regression is gone.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');

console.log('\n── HOTFIX 26 reverted (HOTFIX 27 tombstone) ──');

ok('A1: credit_adjustment uses direct-park (no while-loop drain over open pool)',
  /type === 'credit_adjustment'[\s\S]{0,1500}if \(creditAmt > 0\) s\.theirPrepaid \+= creditAmt;\s*\n\s*if \(debitAmt > 0\) s\.ourPrepaid \+= debitAmt;/.test(ledger));

ok('A2: NO while loop draining openInvoices inside credit_adjustment block',
  (function () {
    var match = ledger.match(/type === 'credit_adjustment'[\s\S]*?else if \(type === 'offset'\)/);
    if (!match) return false;
    return !/while \([\s\S]*?openInvoices\.length/.test(match[0]);
  })());

ok('A3: NO while loop draining openBills inside credit_adjustment block',
  (function () {
    var match = ledger.match(/type === 'credit_adjustment'[\s\S]*?else if \(type === 'offset'\)/);
    if (!match) return false;
    return !/while \([\s\S]*?openBills\.length/.test(match[0]);
  })());

ok('A4: REVERT comment present explaining HOTFIX 27 decision',
  /HOTFIX 27[\s\S]{0,500}REVERTED HOTFIX 26/.test(ledger));

ok('A5: Comment lists the regressions HOTFIX 26 caused',
  /phantom|hallucinat|contradict/i.test(ledger.match(/HOTFIX 27[\s\S]{0,2000}/)[0]));

ok('A6: Comment names the next-step requirement (real data before re-fixing)',
  /real entry data|Supabase|next step/i.test(ledger.match(/HOTFIX 27[\s\S]{0,2000}/)[0]));

console.log('\n── Behavioral check: HOTFIX 26 phantom-payments are GONE ──');

var spawn = require('child_process').spawnSync;
var script = `
import { simulate } from '${path.join(__dirname, '..', 'src/lib/open-account-ledger.js')}';
const r = simulate([
  { id: 'b1', entry_date: '2025-11-27', transaction_type: 'vendor_bill', currency: 'USD', debit_amount: 151570, credit_amount: 0 },
  { id: 'ca', entry_date: '2025-11-27', transaction_type: 'credit_adjustment', currency: 'USD', debit_amount: 10609.90, credit_amount: 0 },
  { id: 'p1', entry_date: '2025-12-16', transaction_type: 'payment_sent', currency: 'USD', debit_amount: 29240, credit_amount: 0 },
  { id: 'p2', entry_date: '2025-12-30', transaction_type: 'payment_sent', currency: 'USD', debit_amount: 80000, credit_amount: 0 },
  { id: 'p3', entry_date: '2026-02-17', transaction_type: 'payment_sent', currency: 'USD', debit_amount: 20000, credit_amount: 0 },
]);
const usd = r.byCurrency.USD;
console.log('billOpen:' + (usd.openBills[0]?.remaining || 0).toFixed(2));
console.log('ourPrepaid:' + usd.ourPrepaid.toFixed(2));
console.log('netBalance:' + usd.netBalance.toFixed(2));
console.log('billsOpenCount:' + usd.openBills.length);
`;
fs.writeFileSync('/tmp/hotfix27_check.mjs', script);
var out = spawn('node', ['--experimental-modules', '/tmp/hotfix27_check.mjs'], { encoding: 'utf8' });
var stdout = out.stdout || '';
var billOpen      = parseFloat((stdout.match(/billOpen:([\d.]+)/) || [])[1] || 'NaN');
var ourPrepaid    = parseFloat((stdout.match(/ourPrepaid:([\d.]+)/) || [])[1] || 'NaN');
var netBalance    = parseFloat((stdout.match(/netBalance:(-?[\d.]+)/) || [])[1] || 'NaN');
var billsOpenCount = parseInt((stdout.match(/billsOpenCount:(\d+)/) || [])[1] || 'NaN', 10);

ok('B1: Vendor bill is NOT phantom-marked-paid (it stays in openBills)',
  billsOpenCount === 1);

ok('B2: Bill open remaining is ~$22,330 (only payment_sent consumed it)',
  billOpen > 22000 && billOpen < 22500);

ok('B3: Our prepaid sits at $10,609.90 (the parked credit, mis-located but transparent)',
  ourPrepaid > 10600 && ourPrepaid < 10620);

ok('B4: Net balance ~-$11,720.10 (mathematically correct regardless of credit location)',
  netBalance > -12000 && netBalance < -11500);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 27 — HOTFIX 26 reverted; phantom-paid bug gone; awaiting real data for next attempt');
console.log('══════════════════════════════════════════════');
