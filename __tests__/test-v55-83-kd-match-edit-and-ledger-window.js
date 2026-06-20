// ============================================================
// v55.83-KD — two open items:
//  (1) Codex P0: editing an EXISTING match amount silently no-op'd. Now the matched row has an inline
//      "Update amount" that reverses & re-applies (atomic, via the tested unmatch + match_invoice routes).
//  (2) KB completeness: CustomerLedger invoice list + payment history now also obey the visibility window.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var br = rd('src/components/BankReviewTab.jsx');
var led = rd('src/components/CustomerLedger.jsx');

// (1) Edit an existing match amount
ok('1: updateMatchAmount persists the new amount via the atomic update_match action (v55.83-KE)',
  /function updateMatchAmount\(m\)/.test(br) &&
  /bankWrite\('update_match', \{/.test(br));
ok('2: update is blocked for Wave-synced payments + capped at the deposit',
  /already pushed to Wave — change it in Wave/.test(br) && /Amount can\\'t exceed the deposit/.test(br));
ok('3: the matched row exposes an inline amount input + "Update amount" button (not a silent no-op)',
  /editMatchAmt\[m\.id\]/.test(br) && /Update amount/.test(br) && /updateMatchAmount\(m\)/.test(br));
ok('4: when already matched, the "Match to invoice" panel relabels to ADD-another (split) + points to Update amount',
  /Add ANOTHER invoice to this deposit \(split\)/.test(br) && /To CHANGE the amount, use .Update amount./.test(br));

// (2) CustomerLedger list + payment history obey the window
ok('5: CustomerLedger invoice LIST is windowed for employees',
  /if \(!isWithinWindow\(i\.invoice_date, ledgerFloor\)\) return false; \/\/ v55\.83-KD/.test(led));
ok('6: CustomerLedger payment HISTORY is windowed for employees',
  /if \(!isWithinWindow\(pd, ledgerFloor\)\) return;/.test(led) &&
  /\}, \[payments, curInvoices, pendingSyncOnly, ledgerFloor\]\)/.test(led));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KD match-edit + ledger-window tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
