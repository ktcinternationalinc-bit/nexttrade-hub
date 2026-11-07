// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QP — Re-match after unmatch (Max, Nov 7 16:01: red banner
// "duplicate key value violates unique constraint uq_invpay_bank_txn_per_
// invoice"). Unmatch voids the payment (never deletes); the one-row-per-
// deposit-per-invoice rule counted the voided corpse, so the SAME pair
// could never be matched again. Now: live pair → plain refusal; voided
// pair → REVIVED in place.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QP — re-match revives the voided pair');
var bw = R('src/app/api/accounting/bank-write/route.js');
ok('1: the pair is checked BEFORE inserting — a LIVE pair refuses with a plain answer (unmatch first / pick another invoice) and rolls back the orphan match row',
  /This deposit is ALREADY matched to this invoice\. To change the amount: ⊘ unmatch first/.test(bw) &&
  bw.indexOf("eq('bank_transaction_id', t.id).eq('accounting_invoice_id', inv.id)") > 0);
ok('2: a VOIDED pair is REVIVED in place — voided:false, fresh amount/date/match link, back to pending_wave_sync; only a truly new pair INSERTS',
  /if \(pairVoid\) \{\n        pIns = await db\.from\('accounting_invoice_payments'\)\.update\(\{ voided: false,/.test(bw) &&
  /\} else \{\n        pIns = await db\.from\('accounting_invoice_payments'\)\.insert\(/.test(bw));
var miSec = bw.split("if (action === 'match_invoice')")[1].split("// 3) overpayment")[0];
ok('3: history never lost in the match path — revive/refuse only, never a payment delete (the one delete in the file is save_splits\' same-call atomic rollback of rows IT just created)',
  miSec.indexOf(".delete(") < 0 && /voided: false,/.test(miSec));
console.log('');
console.log('QP: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
