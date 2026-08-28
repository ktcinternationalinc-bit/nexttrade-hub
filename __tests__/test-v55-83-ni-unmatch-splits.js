// v55.83-NI — unmatch tears down split allocations.
//
// Max's $10,000 deposit 271758 (Aug 25 2026): he split it across invoices, the
// split saved correctly (payments + matches created), then Unmatch was pressed
// again. Unmatch voided the split's payments and matches but LEFT the
// bank_transaction_splits rows and the 'reviewed' status intact — so the
// deposit kept displaying as fully allocated to its invoices while every
// payment behind it was dead. Exactly the report: "the system shows the
// $10,000 has been allocated ... however the amounts have not actually been
// applied."
// — unmatch must tear down SPLIT allocations too.
// Max's $10,000 deposit 271758 (Aug 25): split saved correctly, then Unmatch
// was pressed again — it voided the split's payments and matches but LEFT the
// bank_transaction_splits rows and the 'reviewed' status, so the deposit kept
// displaying as fully allocated while every payment behind it was dead.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fs2 = require('fs');
  var path2 = require('path');
  var bw = fs2.readFileSync(path2.join(__dirname, '..', 'src/app/api/accounting/bank-write/route.js'), 'utf8');
  var un = bw.slice(bw.indexOf("if (action === 'unmatch')"), bw.indexOf("if (action === 'update_match')"));
  var f = [];
  function okN(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }

  okN('NI1: unmatch deletes the split lines (their payments are voided — a split without its payment is pure display)',
    /from\('bank_transaction_splits'\)\.delete\(\)\.eq\('bank_transaction_id', bid\)/.test(un));
  okN('NI2: unmatch voids open unapplied parks on the transaction',
    /from\('unapplied_deposits'\)\.update\(\{ status: 'void' \}\)[\s\S]{0,80}\.eq\('status', 'open'\)/.test(un));
  okN('NI3: unmatch drops the transaction back to unreviewed (no more allocated-looking dead deposits)',
    /review_status: 'unreviewed', reviewed_by: null, reviewed_at: null/.test(un));
  okN('NI4: the incident is documented at the fix site',
    /deposit 271758/.test(un) && /leaves a lie on screen/.test(un));
  okN('NI5: split removal count is reported to the caller',
    /splits_removed: unSplits/.test(un));
  okN('NI6: Wave-synced payments still block unmatch entirely (guard unchanged)',
    /already pushed to Wave — reverse it in Wave/.test(un));
  okN('NI7: recompute still runs for every affected invoice (guard unchanged)',
    /for \(w = 0; w < ik\.length; w\+\+\) \{ await recompute\(db, ik\[w\]\); \}/.test(un));

  if (f.length) { console.log('NI FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NI ADDENDUM CHECKS PASSED'); }
})();

console.log('done');
