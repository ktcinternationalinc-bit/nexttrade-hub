/* v72 HOTFIX 3 — header summary + 4-pot agreement test.
 * Reproduces the screenshot bug Max caught: account header showed
 * "Bal: -4,500 EGP (we owe them)" while the 4-pot strip showed
 * "Net 4,500 in our favor". Now both use the same FIFO source. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oaPath = path.join(__dirname, '..', 'src', 'components', 'OpenAccountsTab.jsx');
var libPath = path.join(__dirname, '..', 'src', 'lib', 'open-account-ledger.js');
var oa = fs.readFileSync(oaPath, 'utf8');
var libCode = fs.readFileSync(libPath, 'utf8')
  .replace(/^'use client';\s*/m, '')
  .replace(/export var /g, 'var ')
  .replace(/export function /g, 'function ');
var origWarn = console.warn; console.warn = function () {};
eval(libCode);
console.warn = origWarn;

console.log('\n── Code structure: FIFO is the single source of truth ──');

ok('A1: entriesByAccount imports + calls simulate per account',
  /var sim = simulate\(arr\)/.test(oa) &&
  /sim\.trail\.forEach/.test(oa));

ok('A2: entry._running_balance comes from FIFO net (not credit−debit)',
  /netForThisCur = \(snap\.theirOpenInvoices - snap\.theirPrepaid\) - \(snap\.ourOpenBills - snap\.ourPrepaid\)/.test(oa) &&
  /entry\._running_balance = netForThisCur/.test(oa));

ok('A3: entry._running_by_currency comes from FIFO trail walk',
  /entry\._running_by_currency = nets/.test(oa));

ok('A4: summaryFor seeds balance from b.netBalance (FIFO)',
  /balance: b\.netBalance,/.test(oa));

ok('A5: summaryFor includes new fields: theyOweUs, weOweThem, theirPrepaid, ourPrepaid',
  /theyOweUs: b\.theirOpenInvoices/.test(oa) &&
  /weOweThem: b\.ourOpenBills/.test(oa) &&
  /theirPrepaid: b\.theirPrepaid/.test(oa) &&
  /ourPrepaid: b\.ourPrepaid/.test(oa));

ok('A6: NO longer using broken `running[cur] += credit - debit` pattern',
  !/running\[cur\] \+= credit - debit/.test(oa));

ok('A7: NO longer using `balance: legacyCredit - legacyDebit` for per-currency balance',
  !/byCur\[cur\]\.balance = byCur\[cur\]\.credit - byCur\[cur\]\.debit/.test(oa));

console.log('\n── End-to-end: Max\'s screenshot scenario ──');
{
  // From screenshot: TEST account
  //   1. Payment Sent USD 1,000 (TEST SEND MONEY)
  //   2. Payment Sent EGP 4,500 (PAYMENT SENT EGP)
  //   3. Vendor Bill USD 10,888 (Invoice INV-TEST-2026-001)
  var entries = [
    { id: 'e1', entry_date: '2026-05-26', created_at: '2026-05-26T10:00Z',
      currency: 'USD', debit_amount: 1000, credit_amount: null,
      transaction_type: 'payment_sent' },
    { id: 'e2', entry_date: '2026-05-26', created_at: '2026-05-26T10:01Z',
      currency: 'EGP', debit_amount: 4500, credit_amount: null,
      transaction_type: 'payment_sent' },
    { id: 'e3', entry_date: '2026-05-26', created_at: '2026-05-26T10:02Z',
      currency: 'USD', debit_amount: 10888, credit_amount: null,
      transaction_type: 'vendor_bill' },
  ];
  var sim = simulate(entries);
  var usd = sim.byCurrency.USD;
  var egp = sim.byCurrency.EGP;

  // USD trace:
  //   payment_sent 1000 → no open bills → ourPrepaid = 1000
  //   vendor_bill 10888 → consumes ourPrepaid 1000 → openBills = 9888
  // Final: ourOpenBills=9888, ourPrepaid=0, theirOpenInvoices=0, theirPrepaid=0
  // Net = (0 - 0) - (9888 - 0) = -9888 (against us)
  ok('B1: USD ourOpenBills = 9,888 (was 10,888 before payment offset)',
    Math.abs(usd.ourOpenBills - 9888) < 0.01);
  ok('B2: USD net = -9,888 (against us — NOT -11,888 from old credit-debit calc)',
    Math.abs(usd.netBalance - (-9888)) < 0.01);
  ok('B3: USD ourPrepaid = 0 (consumed by vendor bill)',
    Math.abs(usd.ourPrepaid - 0) < 0.01);

  // EGP trace:
  //   payment_sent 4500 → no open bills → ourPrepaid = 4500
  // Final: ourOpenBills=0, ourPrepaid=4500
  // Net = (0 - 0) - (0 - 4500) = +4500 (in our favor — they owe us services)
  ok('B4: EGP ourPrepaid = 4,500 (we paid with no bill — prepaid credit with them)',
    Math.abs(egp.ourPrepaid - 4500) < 0.01);
  ok('B5: EGP net = +4,500 (IN OUR FAVOR — fixes the bug where header said "we owe them")',
    Math.abs(egp.netBalance - 4500) < 0.01);
  ok('B6: EGP ourOpenBills = 0 (no actual obligation)',
    Math.abs(egp.ourOpenBills - 0) < 0.01);

  // Verify the OLD broken calc would give DIFFERENT numbers (proves the bug existed)
  var oldUsdBalance = 0; // credit - debit
  var oldEgpBalance = 0;
  entries.forEach(function (e) {
    var cr = Number(e.credit_amount || 0);
    var dr = Number(e.debit_amount || 0);
    if ((e.currency || 'USD') === 'USD') oldUsdBalance += cr - dr;
    if (e.currency === 'EGP') oldEgpBalance += cr - dr;
  });
  ok('C1: OLD broken USD calc would give -11,888 (THIS WAS THE BUG)',
    oldUsdBalance === -11888);
  ok('C2: OLD broken EGP calc would give -4,500 "we owe them" (THIS WAS THE BUG)',
    oldEgpBalance === -4500);
  ok('C3: New FIFO USD (-9,888) DIFFERS from broken old (-11,888) — proves fix',
    usd.netBalance !== oldUsdBalance);
  ok('C4: New FIFO EGP (+4,500) DIFFERS from broken old (-4,500) — proves fix and sign flip',
    egp.netBalance !== oldEgpBalance &&
    Math.sign(egp.netBalance) !== Math.sign(oldEgpBalance));
}

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 3 — header + 4-pot now agree');
console.log('══════════════════════════════════════════════');
