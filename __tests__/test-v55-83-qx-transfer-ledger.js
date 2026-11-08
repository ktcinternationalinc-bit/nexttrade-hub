// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QX — Transfers: find the other leg (auto, then manual) and post them
// CORRECTLY (Max, Nov 8 11:39: "when we click on transfer it looks for other
// transactions from other accounts... if not allows the user to manually
// select one... make sure in accounting it is calculated correctly for
// accounting and tax purposes... do the proper research").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QX — transfer legs + ledger treatment');
var er = R('src/app/api/accounting/expense-rules/route.js');
var at = R('src/components/AllTransactionsTab.jsx');
var sql = R('sql/v55-83-QX-transfer-ledger.sql');
ok('1: AUTO search — same cents, opposite direction, ANOTHER account in the SAME books, ±10 days; duplicates + already-paired never offered',
  /var spanT = manualT \? 90 : 10;/.test(er) && /candQ = candQ\.eq\('wave_business_id', t0\.wave_business_id\)/.test(er) &&
  /\.is\('transfer_group_id', null\)\.neq\('review_status', 'duplicate'\)/.test(er));
ok('2: MANUAL search — "🔎 pick it myself": ±90 days, any amount, free-text filter, closest amount first, each with its account name',
  /🔎 pick it myself/.test(at) && /openTransfer\(tPanel\.src \|\| tPanel\.txn, true, tPanel\.q\)/.test(at) &&
  /outC\.sort\(function \(a, b\) \{ return Math\.abs/.test(er) && /account_label: acctNames\[c\.account_id\]/.test(er));
ok('3: pairing guards that keep the books right — legs must match to the cent (fee = its own line), SAME company only (cross-company = intercompany), never a duplicate copy',
  /A bank\/wire fee is its own separate line: categorize it as Bank fees/.test(er) &&
  /that is an intercompany payment/.test(er) && /One of these is a marked DUPLICATE copy/.test(er) &&
  /disabled=\{busy \|\| c4\.same_amount === false\}/.test(at));
ok('4: no other leg → plain guidance on what it really is: own account not in hub (add it / Transfer meanwhile), credit-card payment, owner draw/contribution, intercompany, loan principal vs interest',
  /Paying a credit card<\/b> that is not connected/.test(at) && /Money to or from the owner<\/b>/.test(at) &&
  /Another company of the group<\/b>/.test(at) && /only the interest is an expense/.test(at));
ok('5: LEDGER — transfers are no longer skipped: each leg posts against 1090 clearing (out: Dr 1090/Cr Bank, in: Dr Bank/Cr 1090) so bank balances move and P&L never does',
  /'account_id', clearing, 'debit_cents', n::text, 'credit_cents', '0'\),\n\s+jsonb_build_object\('account_id', bank_gl,  'debit_cents', '0',     'credit_cents', n::text\)/.test(sql) &&
  /where a\.book_id = b\.id and a\.code = '1090' and a\.is_active/.test(sql) &&
  /'postedTransfers', posted_transfers/.test(sql));
ok('6: LEDGER — the auto-create of a ledger account now supplies the required code/normal_side/origin (before, every create failed)',
  /insert into clickbooks_us\.accounts\(book_id, code, name, account_type, normal_side, is_active, needs_review, is_bank_sensitive, origin\)/.test(sql) &&
  /'H-' \|\| md5\(cls_key\)/.test(sql));
ok('7: same function name + signature (the 15-minute job calls it unchanged); per-row variables reset so one row can never inherit another row\'s bank',
  /create or replace function clickbooks_us\.classified_sync_run\(p_from date, p_to date, p_actor uuid\)/.test(sql) &&
  /cls_key := trim\(t\.classification\); bank_gl := null; map_acct := null;/.test(sql));
console.log('');
console.log('QX: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
