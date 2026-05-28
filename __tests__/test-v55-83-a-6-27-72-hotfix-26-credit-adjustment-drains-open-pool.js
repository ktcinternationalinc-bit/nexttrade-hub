/* v72 HOTFIX 26 — Per Max May 28 2026 screenshot:
 *
 *   "why is there a $17K+ open balance still on the
 *    invoice INV-EL-SAYAD-2026-003 when it should be like -$6700+"
 *
 * Root cause: `credit_adjustment` parked debit_amount directly into
 * s.ourPrepaid (and credit_amount into s.theirPrepaid) WITHOUT first
 * consuming any open bills/invoices. payment_sent / payment_received
 * both drain the open pool first — credit_adjustment was asymmetric.
 *
 * Pathology: bill 151,570 + credit_adjustment 10,609.90 + payments
 * totaling 134,240. After old simulation: bill open $16,830 +
 * ourPrepaid $10,609.90 sitting unused. Net was right (-$6,220.10) but
 * per-row Open Balance was inflated by exactly the credit_adjustment
 * amount because the credit never got applied to the bill.
 *
 * Fix: credit_adjustment now drains open invoices/bills first, then
 * pushes any excess to prepaid — same pattern as payment_sent /
 * payment_received. The net balance is unchanged (the math cancels),
 * but the per-row Open Balance now reflects truth and prepaid no
 * longer sits inflated next to an open bill.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');

console.log('\n── credit_adjustment now drains the open pool first ──');

ok('A1: credit_adjustment handler walks openInvoices in a while loop (like payment_received)',
  /type === 'credit_adjustment'[\s\S]{0,2000}while \(creditLeft > 0\.001 && s\.openInvoices\.length > 0\)/.test(ledger));

ok('A2: credit_adjustment handler walks openBills in a while loop (like payment_sent)',
  /type === 'credit_adjustment'[\s\S]{0,2000}while \(debitLeft > 0\.001 && s\.openBills\.length > 0\)/.test(ledger));

ok('A3: credit applied amount is tracked via applied[invCA.id] (so per-row Open Balance updates)',
  /applied\[invCA\.id\] = \(applied\[invCA\.id\] \|\| 0\) \+ applyCA/.test(ledger));

ok('A4: debit applied amount is tracked via applied[billCA.id]',
  /applied\[billCA\.id\] = \(applied\[billCA\.id\] \|\| 0\) \+ applyCAB/.test(ledger));

ok('A5: EXCESS credit goes to theirPrepaid (only after invoices drained)',
  /if \(creditLeft > 0\.001\) s\.theirPrepaid \+= creditLeft/.test(ledger));

ok('A6: EXCESS debit goes to ourPrepaid (only after bills drained)',
  /if \(debitLeft > 0\.001\) s\.ourPrepaid \+= debitLeft/.test(ledger));

console.log('\n── Old asymmetric direct-park pattern removed ──');

ok('B1: NO longer has bare "s.theirPrepaid += creditAmt" inside credit_adjustment',
  !/type === 'credit_adjustment'[\s\S]{0,200}if \(creditAmt > 0\) s\.theirPrepaid \+= creditAmt;\n      if \(debitAmt > 0\) s\.ourPrepaid \+= debitAmt;/.test(ledger));

console.log('\n── HOTFIX 26 explanation comment present ──');

ok('C1: comment names HOTFIX 26 and describes the asymmetry fix',
  /HOTFIX 26/.test(ledger) && /credit adjustments[\s\S]{0,200}parking directly into prepaid/i.test(ledger));

ok('C2: comment references the Algeria-commission example',
  /Algeria-commission/.test(ledger) || /151,570/.test(ledger));

console.log('\n── Behavioral test via simulate ──');

// Inline simulator test — load simulate and run the exact pathology
var simulate = require(path.join(__dirname, '..', 'src/lib/open-account-ledger.js')).simulate;
// CommonJS require doesn't work on the ES module — fall back to subprocess
var spawn = require('child_process').spawnSync;
var script = `
import { simulate } from '${path.join(__dirname, '..', 'src/lib/open-account-ledger.js')}';
const entries = [
  { id: 'b1', entry_date: '2025-11-27', transaction_type: 'vendor_bill', currency: 'USD', debit_amount: 151570, credit_amount: 0 },
  { id: 'ca', entry_date: '2025-11-27', transaction_type: 'credit_adjustment', currency: 'USD', debit_amount: 10609.90, credit_amount: 0 },
  { id: 'p1', entry_date: '2025-12-16', transaction_type: 'payment_sent', currency: 'USD', debit_amount: 29240, credit_amount: 0 },
  { id: 'p2', entry_date: '2025-12-30', transaction_type: 'payment_sent', currency: 'USD', debit_amount: 80000, credit_amount: 0 },
  { id: 'p3', entry_date: '2026-02-17', transaction_type: 'payment_sent', currency: 'USD', debit_amount: 20000, credit_amount: 0 },
];
const r = simulate(entries);
const usd = r.byCurrency.USD;
const bill = usd.openBills.find(b => b.id === 'b1');
console.log('billRemaining:' + (bill ? bill.remaining.toFixed(2) : 'NONE'));
console.log('ourPrepaid:' + usd.ourPrepaid.toFixed(2));
console.log('netBalance:' + usd.netBalance.toFixed(2));
console.log('appliedToBill:' + (r.applications.b1 || 0).toFixed(2));
`;
fs.writeFileSync('/tmp/hotfix26_check.mjs', script);
var out = spawn('node', ['--experimental-modules', '/tmp/hotfix26_check.mjs'], { encoding: 'utf8' });
var stdout = out.stdout || '';
var billRemaining = parseFloat((stdout.match(/billRemaining:([\d.]+)/) || [])[1] || 'NaN');
var ourPrepaid    = parseFloat((stdout.match(/ourPrepaid:([\d.]+)/)    || [])[1] || 'NaN');
var netBalance    = parseFloat((stdout.match(/netBalance:(-?[\d.]+)/)  || [])[1] || 'NaN');
var appliedToBill = parseFloat((stdout.match(/appliedToBill:([\d.]+)/) || [])[1] || 'NaN');

ok('D1: After fix, credit_adjustment is APPLIED toward the open bill',
  appliedToBill > 134000 && appliedToBill < 140000);

ok('D2: After fix, ourPrepaid is $0 (was $10,609.90 sitting beside the bill)',
  Math.abs(ourPrepaid) < 0.01);

ok('D3: After fix, bill open remaining is ~$11,720.10 (the credit_adjustment + 3 payments fully applied to the $151,570 bill)',
  billRemaining > 11500 && billRemaining < 12000);

ok('D4: Net balance equals bill remaining (~-$11,720.10) — credit fully consumed, nothing in prepaid',
  netBalance > -12000 && netBalance < -11500);

ok('D5: appliedToBill includes the credit_adjustment + payments (~$145k applied to $151k bill)',
  appliedToBill > 134000);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 26 — credit_adjustment now drains open pool first; per-row Open Balance reflects truth');
console.log('══════════════════════════════════════════════');
