// ============================================================
// v55.83-MU — Accounting Bank Review duplicate guard.
// Scope is ONLY Accounting -> Bank Review/Matching:
//   - hide high-confidence relink duplicate extras from normal review
//   - preserve protected accounting rows
//   - mark extras duplicate through the accounting bank-write route
//   - never touch BankTab/Treasury/Open Accounts here
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
var route = rd('src/app/api/accounting/bank-write/route.js');

ok('1: Bank Review computes a stable duplicate key from silo/mask/date/direction/amount/description',
  /function duplicateKeyOf\(t\)/.test(br) &&
  /maskKeyOf\(t\.account_id\)/.test(br) &&
  /txnAmountCents\(t\)/.test(br) &&
  /normDuplicateText\(t\.name \|\| t\.merchant_name/.test(br));

ok('2: auto-hiding only applies to high-confidence relink aliases, not same-account repeated charges',
  /var highConfidenceRelink = Object\.keys\(acctIds\)\.length > 1;/.test(br) &&
  /if \(!highConfidenceRelink\) \{ return; \}/.test(br));

ok('3: protected accounting rows are preserved as keepers and not hidden',
  /function hasAccountingActivity\(t\)/.test(br) &&
  /matchesByTxn\[t\.id\]/.test(br) &&
  /paysByTxn\[t\.id\]/.test(br) &&
  /allocByTxn\[t\.id\]/.test(br) &&
  /if \(hasAccountingActivity\(t\)\) \{ conflicted\+\+; return; \}/.test(br));

ok('4: default review filters hide inferred extras and already-marked duplicates, while Duplicate filter inspects them',
  /if \(fStatus === 'duplicate'\) \{[\s\S]{0,180}duplicateReview\.hidden/.test(br) &&
  /fStatus === 'all'[\s\S]{0,120}!duplicateReview\.hidden/.test(br) &&
  /\(t\.review_status \|\| 'unreviewed'\) !== 'duplicate' && !duplicateReview\.hidden/.test(br));

ok('5: operator cleanup calls a dedicated accounting route action, not generic set_status loops',
  /function markHiddenDuplicates\(\)/.test(br) &&
  /bankWrite\('mark_review_duplicates'/.test(br) &&
  /duplicate_transaction_ids: ids/.test(br));

ok('6: detail actions refuse duplicate rows before classify/category/match/split/park/approve',
  /isReviewDuplicate\(t\)[\s\S]{0,120}cannot be classified/.test(br) &&
  /isReviewDuplicate\(t\)[\s\S]{0,120}cannot be categorized/.test(br) &&
  /isReviewDuplicate\(t\)[\s\S]{0,120}cannot be approved/.test(br) &&
  /isReviewDuplicate\(t\)[\s\S]{0,140}original transaction row/.test(br));

ok('7: route has dedicated mark_review_duplicates action with service-role permission',
  /action === 'mark_review_duplicates'/.test(route) &&
  /duplicate_transaction_ids/.test(route) &&
  /markIds\.length/.test(route));

ok('8: route re-reads candidates, recomputes duplicate groups with plaid account masks, and requires alias account ids',
  /from\('bank_transactions'\)\.select\('id, wave_business_id/.test(route) &&
  /from\('plaid_accounts'\)\.select\('plaid_account_id, mask'\)/.test(route) &&
  /duplicateKeyForRow/.test(route) &&
  /Object\.keys\(seenAcct\)\.length < 2/.test(route));

ok('9: route refuses protected duplicate marking and never deletes/voids money rows in cleanup',
  /async function protectedBankTxnIds/.test(route) &&
  /payment_matches/.test(route) &&
  /accounting_invoice_payments/.test(route) &&
  /bank_transaction_splits/.test(route) &&
  /unapplied_deposits/.test(route) &&
  /customer_credits/.test(route) &&
  /review_status: 'duplicate'/.test(route) &&
  !/mark_review_duplicates[\s\S]{0,4500}\.delete\(\)/.test(route) &&
  !/mark_review_duplicates[\s\S]{0,4500}voided: true/.test(route));

ok('10: manual set_status duplicate is hardened against active accounting activity',
  /body\.status === 'duplicate'/.test(route) &&
  /protectedBankTxnIds\(db, \[dRow\]\)/.test(route) &&
  /cannot be marked duplicate from Bank Review/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MU Bank Review duplicate tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
