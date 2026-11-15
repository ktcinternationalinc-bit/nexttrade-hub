// ============================================================
// v55.83-KE — Codex P0: editing an existing match needs a real atomic server state transition, not a
// two-call client dance. NEW bank-write action update_match: reverse old + apply new, recompute BOTH
// invoices, block when already pushed to Wave (needs_wave_reversal), no orphans/duplicates.
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

ok('1: update_match action exists + is payments.match gated',
  /action === 'update_match'/.test(route) &&
  // v55.83-MU loosened: update_match must sit inside the payments.match branch of the permKey
  // ternary, but OTHER actions may be OR'd after it (MU appended mark_review_duplicates) —
  // the old exact-adjacency regex false-failed on a boolean reorder, not a real gate change.
  (function () {
    var m = route.match(/var permKey = \(([^?]*)\) \? 'payments\.match'/);
    return !!(m && m[1].indexOf("action === 'update_match'") >= 0);
  })());
ok('2: blocks editing a match whose payment is already in Wave (needs_wave_reversal, no silent overwrite)',
  /pp\.wave_payment_id \|\| pp\.sync_status === 'synced' \|\| pp\.sync_status === 'manual_done'/.test(route) &&
  /needs_wave_reversal: true/.test(route));
ok('3: APPLY-NEW-FIRST then REVERSE-OLD — new match+payment inserted before old rows are voided (v55.83-KG money-safety)',
  (function () {
    var iApply = route.indexOf('1) APPLY NEW FIRST');
    var iNewMatch = route.indexOf("from('payment_matches').insert({", iApply);
    var iReverse = route.indexOf('2) REVERSE OLD');
    var iVoidOld = route.indexOf("from('payment_matches').update({ voided: true }).eq('bank_transaction_id', uTid).neq('id', uMid");
    var hasVoidPay = route.indexOf("from('accounting_invoice_payments').update({ voided: true, sync_status: 'void' }).eq('bank_transaction_id', uTid).neq('id', uPid") >= 0;
    return iApply >= 0 && iNewMatch > iApply && iReverse > iNewMatch && iVoidOld > iReverse && hasVoidPay;
  })());
ok('4: recomputes BOTH the old invoice(s) and the new invoice',
  /for \(uok = 0; uok < uOldKeys\.length; uok\+\+\)[\s\S]{0,120}recompute\(db, uOldKeys\[uok\]\)/.test(route) &&
  /uRecomputed = await recompute\(db, uNi\.id\)/.test(route));
ok('5: enforces same-silo + deposit cap + not-approved on the edit',
  /Cross-silo: the new invoice belongs to a different Wave business/.test(route) &&
  /exceeds the deposit/.test(route) &&
  /Transaction is approved — reopen it first/.test(route));
ok('6: overpayment on the edited match routes to credit/unapplied (no money lost)',
  /if \(uCc\.overpayment > 0\)/.test(route) && /from\('customer_credits'\)\.insert/.test(route));
ok('7: client updateMatchAmount uses the single atomic update_match (not two-call unmatch+match)',
  /bankWrite\('update_match', \{[\s\S]{0,200}new_invoice_id: inv\.id, amount: newAmt/.test(br));
ok('8: matched panel shows the real Wave sync state (pending/synced) + payment row count',
  /var pushed = ps\.some\(function \(p\) \{ return p\.wave_payment_id \|\| p\.sync_status === 'synced'/.test(br) &&
  /Wave sync: <b>\{st\}<\/b>/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KE update_match-atomic tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
