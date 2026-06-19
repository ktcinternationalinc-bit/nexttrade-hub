// ============================================================
// v55.83-JC — ACCOUNTING INTEGRITY: a bank transaction must conserve money. A partially-allocated
// deposit (invoice payment + splits + unapplied < transaction total) can NO LONGER be marked
// reviewed/approved, and partial paths no longer silently finalize the transaction (Codex P0).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

// --- A. Pure money math (runtime behavior, not just text) ---
var pm = require('../src/lib/payment-matching.js');
var full = pm.bankAllocationStatus({ txnAmount: 250, paid: 100 });
ok('A1: partial allocation (100 of 250) is NOT complete', full.complete === false && Math.abs(full.remaining - 150) < 0.001 && full.hasPiecewise === true);
var exact = pm.bankAllocationStatus({ txnAmount: 1000, paid: 800, unapplied: 200 });
ok('A2: invoice payment + unapplied that sum to the total IS complete', exact.complete === true && Math.abs(exact.remaining) < 0.001);
var over = pm.bankAllocationStatus({ txnAmount: 250, paid: 100, split: 200 });
ok('A3: over-allocation is flagged and not complete', over.overAllocated === true && over.complete === false);
var whole = pm.bankAllocationStatus({ txnAmount: 250 });
ok('A4: a whole-category transaction (no piecewise rows) is complete', whole.hasPiecewise === false && whole.complete === true);
var vs = pm.validateSplit(250, [{ split_amount: 100 }]);
ok('A5: validateSplit exposes fullyAllocated=false for a partial split', vs.fullyAllocated === false && Math.abs(vs.remaining - 150) < 0.001);
var vsf = pm.validateSplit(250, [{ split_amount: 100 }, { split_amount: 150 }]);
ok('A6: validateSplit fullyAllocated=true when lines cover the whole txn', vsf.fullyAllocated === true);

// --- B. Bank Review gates reviewed/approved on completeness ---
var br = rd('src/components/BankReviewTab.jsx');
ok('B1: setStatus blocks reviewed/approved unless fully allocated',
  /if \(status === 'reviewed' \|\| status === 'approved'\)/.test(br) && /!allocS\.complete/.test(br) && /is unallocated\./.test(br));
ok('B2: approve has the same money-conservation gate', /!allocA\.complete/.test(br) && /Every dollar must be accounted for before approving/.test(br));
ok('B3: txnAllocation uses the loaded allocation map + bankAllocationStatus',
  /function txnAllocation\(t\)/.test(br) && /bankAllocationStatus\(\{ txnAmount: total, paid: a\.paid, split: a\.split, unapplied: a\.unapplied \}\)/.test(br));
ok('B4: allocation map is built from payments + splits + open unapplied deposits in load()',
  /from\('bank_transaction_splits'\)\.select\('bank_transaction_id, split_amount'\)/.test(br) &&
  /from\('unapplied_deposits'\)\.select\('bank_transaction_id, amount, status'\)/.test(br) &&
  /bucket\(p\.bank_transaction_id\)\.paid/.test(br) && /setAllocByTxn\(allocBy\)/.test(br));

// --- C. saveSplits requires exact allocation before marking reviewed ---
ok('C1: saveSplits blocks when the split is not fully allocated',
  /if \(!v\.fullyAllocated\)/.test(br) && /remains unallocated\. Add another line/.test(br));

// --- D. Partial apply / park no longer silently finalize the transaction ---
ok('D1: applyToInvoice toast is honest about an unallocated remainder',
  /j\.fully_allocated === false && rem > 0\.01/.test(br) && /still unallocated/.test(br));
ok('D2: createUnapplied only flips to reviewed when the park completes allocation',
  /parkComplete \? 'reviewed' : t\.review_status/.test(br) || /\(t\.review_status === 'unreviewed' && parkComplete\) \? 'reviewed'/.test(br));

// --- E. Explicit residual action (no silent auto-uncategorize) ---
ok('E1: split mode has an explicit "remainder as Needs review" button (Hub-only)',
  /remainder \(/.test(br) && /needs_clarification/.test(br) && /Hub-only/.test(br));

// --- F. Server: review_status flip is conditional on full deposit allocation ---
var route = rd('src/app/api/accounting/bank-write/route.js');
ok('F1: match_invoice only auto-marks reviewed when the deposit is fully allocated',
  /var fullyAllocated = !\(depositAmt > 0\) \|\| depositRemaining <= 0\.01/.test(route) &&
  /var nextStatus = \(t\.review_status === 'unreviewed' && fullyAllocated\) \? 'reviewed' : t\.review_status/.test(route));
ok('F2: match_invoice returns deposit_remaining + fully_allocated to the client',
  /deposit_remaining: depositRemaining, fully_allocated: fullyAllocated/.test(route));

// --- G. Server set_status is the AUTHORITATIVE gate (closes the service-role bypass Codex flagged) ---
ok('G1: bank-write computes server-side allocation (payments + splits + open unapplied)',
  /async function allocationForTxn\(db, txnId\)/.test(route) &&
  /from\('accounting_invoice_payments'\)\.select\('amount, voided, sync_status'\)\.eq\('bank_transaction_id', txnId\)/.test(route) &&
  /from\('bank_transaction_splits'\)\.select\('split_amount'\)\.eq\('bank_transaction_id', txnId\)/.test(route) &&
  /from\('unapplied_deposits'\)\.select\('amount, status'\)\.eq\('bank_transaction_id', txnId\)/.test(route));
ok('G2: set_status blocks reviewed/approved server-side when not fully allocated (direct-route bypass closed)',
  /if \(body\.status === 'reviewed' \|\| body\.status === 'approved'\) \{[\s\S]{0,600}allocationForTxn\(db, body\.bank_transaction_id\)/.test(route) &&
  /if \(alloc && !alloc\.complete\)[\s\S]{0,160}is unallocated\./.test(route) &&
  /if \(alloc && alloc\.overAllocated\)/.test(route));
ok('G3: allocation math includes customer_credits (overpayment routed to a credit is not under-counted)',
  /from\('customer_credits'\)\.select\('amount, status'\)\.eq\('source_transaction_id', txnId\)/.test(route));
ok('G4: classify/set_wave_category strip the auto-review when the txn is not fully allocated (no category-side bypass)',
  /cPatch\.review_status === 'reviewed' \|\| cPatch\.review_status === 'approved'/.test(route) &&
  /delete cPatch\.review_status; delete cPatch\.reviewed_by; delete cPatch\.reviewed_at; autoReviewStripped = true/.test(route));
// runtime: an overpayment parked as a customer credit completes the deposit (folds into the parked bucket)
var withCredit = pm.bankAllocationStatus({ txnAmount: 1000, paid: 800, unapplied: 200 });
ok('G5: 800 invoice payment + 200 parked (credit/unapplied) fully allocates a 1000 deposit', withCredit.complete === true && Math.abs(withCredit.remaining) < 0.001);

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JC allocation-completeness tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
