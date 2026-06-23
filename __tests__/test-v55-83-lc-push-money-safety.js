// ============================================================
// v55.83-LC — Codex KZ money-safety review. Five required items before bank-transaction Wave push is
// release-safe:
//  (1) Dry Run must support transaction rows + show the Wave anchor (bank-side) account.
//  (2) Anchor risk: a single silo-level deposit account can post a ··6338 txn to the wrong Wave bank
//      account — block multi-account silos until a per-account mapping exists.
//  (3) logFail must be AWAITED so a Wave rejection reliably persists as sync_failed + a log row.
//  (4) Edit-after-push: block changing the category of an already-synced transaction (Wave has no update).
//  (5) Save the raw Wave read-back introspection evidence (not assertion-only).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function exists(p) { try { fs.accessSync(path.join(__dirname, '..', p)); return true; } catch (e) { return false; } }
var route = rd('src/app/api/wave/push-transaction/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');
var bw = rd('src/app/api/accounting/bank-write/route.js');

ok('1: Dry Run previews transaction rows via the SERVER and shows the Wave anchor (bank-side) account',
  /if \(q\.action !== 'transaction'\) \{/.test(sync) &&
  /dry_run: true, user_id: userProfile && userProfile\.id/.test(sync) &&
  /Bank side \(anchor\): ' \+ \(d\.anchor_account \|\| '\?'\)/.test(sync) &&
  /anchor_account: anchorName \|\| anchorAcct, anchor_via: anchorVia, direction: dir/.test(route));
ok('1b: the journal is a BALANCED double-entry (v55.83-MA money-safety) — equal DEBIT and CREDIT lines for the same amount, never a single-sided line Wave rejects',
  /function buildMoneyTxnLineItems\(direction, bankAcctId, categoryAcctId, amtStr\)/.test(route) &&
  /balance: 'DEBIT' \}, \{ accountId: categoryAcctId, amount: amtStr, balance: 'CREDIT' \}/.test(route) &&
  /balance: 'DEBIT' \}, \{ accountId: bankAcctId, amount: amtStr, balance: 'CREDIT' \}/.test(route) &&
  !/balance: 'INCREASE' \}\]/.test(route));
ok('2: multi-account anchor safety — PER-ACCOUNT resolution (LZ): the txn anchors to its own bank\'s Wave account by mask, with single-account + silo-default fallbacks; no blanket multi-account block',
  /function maskMatches\(waveName, mask\)/.test(route) &&
  /anchorVia = 'matched-by-mask:'/.test(route) &&
  !/if \(distinctAccts > 1\) \{ return blocked\(/.test(route));
ok('3: logFail is async + AWAITED at both Wave-rejection call sites (reliable sync_failed + log)',
  /async function logFail\(msg, extra\) \{/.test(route) &&
  /try \{ await db\.from\('bank_transactions'\)\.update\(\{ category_status: 'sync_failed' \}\)/.test(route) &&
  /await logFail\(joined, \{ wave_errors: data\.errors \}\);/.test(route) &&
  /await logFail\(ieJoined, \{ input_errors: inputErrors \}\);/.test(route));
ok('4: edit-after-push guard — changing the category of an already-synced transaction is blocked',
  /var alreadyPushed = !!\(preRow && \(preRow\.category_status === 'synced' \|\| preRow\.wave_transaction_id\)\);/.test(bw) &&
  /var changingCat = !!\(body\.patch && Object\.prototype\.hasOwnProperty\.call\(body\.patch, 'wave_account_id'\)/.test(bw) &&
  /if \(alreadyPushed && changingCat\) \{ return NextResponse\.json\(\{ ok: false, already_pushed: true/.test(bw));
ok('5: raw Wave read-back introspection evidence is saved (not assertion-only)',
  exists('WAVE_API_TRANSACTION_EVIDENCE.md') &&
  /Cannot query field .*moneyTransactions.* on type .*Business/.test(rd('WAVE_API_TRANSACTION_EVIDENCE.md')) &&
  /moneyTransactionCreate/.test(rd('WAVE_API_TRANSACTION_EVIDENCE.md')));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LC push money-safety tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
