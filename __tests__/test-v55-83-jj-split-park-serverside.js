// ============================================================
// v55.83-JJ — Bank Review split-save + park-unapplied must persist through the SERVICE ROLE, not a
// browser dbInsert (the email-auth RLS "save does nothing" class). Service route enforces full
// allocation + only marks reviewed when complete. (Codex P1, pre-build-reviewed design.)
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/accounting/bank-write/route.js');
var br = rd('src/components/BankReviewTab.jsx');

// --- Route: new service-role actions ---
ok('1: route has save_splits + create_unapplied actions',
  /action === 'save_splits'/.test(route) && /action === 'create_unapplied'/.test(route));
ok('2: both actions require payments.match (they allocate money)',
  /action === 'save_splits' \|\| action === 'create_unapplied'\) \? 'payments\.match'/.test(route));
ok('3: save_splits enforces FULL allocation (sum must equal amount_abs)',
  /Math\.abs\(sum - depAmt\) > 0\.01/.test(route) && /A split must allocate the full amount/.test(route));
ok('4: save_splits blocks money-out invoice links + approved txns',
  /isOut && rows\[ri2\]\.invoice_id/.test(route) && /Transaction is approved — reopen it first/.test(route));
ok('5: save_splits creates match + payment + recompute for invoice lines, with overpayment -> credit/unapplied',
  /from\('payment_matches'\)\.insert/.test(route) && /from\('accounting_invoice_payments'\)\.insert/.test(route) &&
  /await recompute\(db, inv2\.id\)/.test(route) && /cc\.overpayment > 0/.test(route));
ok('6: save_splits marks reviewed ONLY when allocationForTxn is complete after writes',
  /var spAlloc = await allocationForTxn\(db, t\.id\)/.test(route) &&
  /tRow\.review_status === 'unreviewed' && spAlloc && spAlloc\.complete/.test(route));
ok('7: save_splits rolls back the match if the payment insert fails (atomic-ish)',
  /payment_matches'\)\.update\(\{ voided: true \}\)\.eq\('id', mId\)[\s\S]{0,120}Split payment save failed/.test(route));
ok('8: create_unapplied inserts the deposit + marks reviewed only when the park completes allocation',
  /from\('unapplied_deposits'\)\.insert\(\{[\s\S]{0,200}status: 'open'/.test(route) &&
  /uRow0\.review_status === 'unreviewed' && uAlloc && uAlloc\.complete/.test(route));

// --- Client: writes go through the route, not browser dbInsert ---
ok('9: saveSplits posts to save_splits (no direct dbInsert on bank_transaction_splits / payment_matches)',
  /bankWrite\('save_splits'/.test(br) &&
  !/dbInsert\('bank_transaction_splits'/.test(br) &&
  !/dbInsert\('payment_matches'/.test(br));
ok('10: createUnapplied posts to create_unapplied (no direct dbInsert on unapplied_deposits)',
  /bankWrite\('create_unapplied'/.test(br) && !/dbInsert\('unapplied_deposits'/.test(br));
ok('11: saveSplits still resolves wave:<id> client-side to a real wave_account_id before sending',
  /r\.category\.indexOf\('wave:'\) === 0/.test(br) && /row\.wave_account_id = _cat\.wave_account_id/.test(br));
ok('12: client still enforces fullyAllocated before calling the route (defense in depth)',
  /if \(!v\.fullyAllocated\)/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JJ split/park service-route tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
