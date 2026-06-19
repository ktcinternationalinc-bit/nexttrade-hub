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
ok('7: save_splits rolls back all created rows if the payment insert fails (atomic-ish)',
  /Split payment save failed \(rolled back\)/.test(route));
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

// --- JK behavioral fixes (Codex JJ review) ---
var pm = require('../src/lib/payment-matching.js');
// BEHAVIORAL: 250 = 100 invoice line + 150 category line, with the invoice line's payment row.
// The invoice-linked split must NOT be double-counted against its payment row.
var dc = pm.summarizeBankAllocation({
  total: 250,
  payments: [{ amount: 100 }],
  splits: [{ split_amount: 100, linked_type: 'invoice' }, { split_amount: 150, linked_type: 'category' }],
  unapplied: [], credits: []
});
ok('JK1: 250 = 100 invoice(+payment) + 150 category is COMPLETE and not over-allocated (no double-count)',
  dc.complete === true && dc.overAllocated === false && Math.abs(dc.remaining) < 0.001 && Math.abs(dc.allocated - 250) < 0.001);
// guard: if we wrongly counted the invoice split too, allocated would be 350/over
var dcBad = pm.bankAllocationStatus({ txnAmount: 250, paid: 100, split: 250, unapplied: 0 });
ok('JK2: (control) counting the invoice split AND its payment would over-allocate (350) — proving the exclusion matters',
  dcBad.overAllocated === true);
ok('JK3: allocationForTxn selects linked_type + delegates to summarizeBankAllocation',
  /from\('bank_transaction_splits'\)\.select\('split_amount, linked_type'\)/.test(route) && /return summarizeBankAllocation\(\{/.test(route));
ok('JK4: summarizeBankAllocation excludes invoice-linked splits',
  /String\(s\.linked_type \|\| ''\) !== 'invoice'/.test(rd('src/lib/payment-matching.js')));
ok('JK5: create_unapplied REJECTS over-park BEFORE inserting',
  /var uPre = await allocationForTxn\(db, ut\.id\)[\s\S]{0,260}would over-allocate this/.test(route) &&
  route.indexOf('would over-allocate this') < route.indexOf("from('unapplied_deposits').insert"));
ok('JK6: save_splits pre-fetches + validates ALL invoices before the write loop',
  /\.in\('id', invIds\)/.test(route) && /Split references an invoice that was not found \('/.test(route));
ok('JK7: save_splits rolls back created split/match/payment rows on a mid-loop write failure',
  /async function rollbackSplits\(\)/.test(route) && /await rollbackSplits\(\); return NextResponse\.json\(\{ ok: false/.test(route));
ok('JK8: client allocByTxn ALSO excludes invoice-linked splits (UI matches server, no double-count)',
  /bank_transaction_splits'\)\.select\('bank_transaction_id, split_amount, linked_type'\)/.test(br) &&
  /if \(String\(s\.linked_type \|\| ''\) === 'invoice'\) \{ return; \}/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JJ split/park service-route tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
