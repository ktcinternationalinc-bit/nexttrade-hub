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

// ══════════════════════════════════════════════════════════════════
// v55.83-NJ ADDENDUM — the accountant can redo the split herself.
// Max (Aug 28): "she intended to now split it among 3 ... can you just leave
// it as is and she can update it on her own. will your fix allow this?"
// Two blockers removed: (1) the client's "Nothing to unmatch" guard refused
// stale-split deposits (all payments voided => both maps empty; the alloc
// bucket rightly excludes invoice-linked splits, so it read zero too);
// (2) save_splits piled new rows on top of stale ones — and worse, had no
// guard against creating a second set of payments on a LIVE deposit.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fs3 = require('fs');
  var path3 = require('path');
  var brt = fs3.readFileSync(path3.join(__dirname, '..', 'src/components/BankReviewTab.jsx'), 'utf8');
  var bw2 = fs3.readFileSync(path3.join(__dirname, '..', 'src/app/api/accounting/bank-write/route.js'), 'utf8');
  var sp = bw2.slice(bw2.indexOf("if (action === 'save_splits')"), bw2.indexOf("if (action === 'classify'"));
  var f2 = [];
  function okJ(l, c) { if (c) console.log('✓ ' + l); else { f2.push(l); console.log('✗ ' + l); } }

  okJ('NJ1: client builds a RAW split-row count (no invoice exclusion — that map is for allocation, not presence)',
    /var splitCountBy = \{\};/.test(brt) && /splitCountBy\[s\.bank_transaction_id\] = \(splitCountBy\[s\.bank_transaction_id\] \|\| 0\) \+ 1;/.test(brt));
  okJ('NJ2: unmatch guard lets a stale-split deposit through',
    /var staleSplits = \(splitCountByTxn\[t\.id\] \|\| 0\) > 0;/.test(brt) &&
    /if \(ms\.length === 0 && orphanPays\.length === 0 && !staleSplits\)/.test(brt));
  okJ('NJ3: the stale case gets its own honest confirm wording',
    /Clear the split allocation on this transaction\?/.test(brt));
  okJ('NJ4: save_splits BLOCKS when live payments exist (no second set of payment rows, ever)',
    /Unmatch it first, then split — saving a split on top would count the money twice/.test(sp) &&
    /isPaymentVoid\(lpRows\[lp\]\)/.test(sp));
  okJ('NJ5: save_splits REPLACES stale split rows instead of stacking',
    /from\('bank_transaction_splits'\)\.delete\(\)\.eq\('bank_transaction_id', t\.id\)/.test(sp));
  okJ('NJ6: replacing stale rows un-reviews FIRST so a mid-write crash cannot leave a reviewed empty deposit',
    /staleRemoved > 0 && tRow\.review_status === 'reviewed'/.test(sp) &&
    /tRow\.review_status = 'unreviewed';/.test(sp));
  okJ('NJ7: the guard runs BEFORE the write phase',
    sp.indexOf('count the money twice') < sp.indexOf('Write phase'));
  okJ('NJ8: the response reports how many stale rows were replaced',
    /stale_splits_replaced: staleRemoved/.test(sp));

  if (f2.length) { console.log('NJ FAILED: ' + f2.join(' | ')); process.exit(1); }
  else { console.log('ALL NJ ADDENDUM CHECKS PASSED'); }
})();
