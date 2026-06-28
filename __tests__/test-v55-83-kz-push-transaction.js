// ============================================================
// v55.83-KZ — Max: "the bank txn need to be synced with wave. the instructions are incorrect." Live
// schema introspection (2026-06-21) confirmed Wave's public API DOES support moneyTransactionCreate, which
// OVERTURNS the old "Wave can't accept transaction pushes" claim. New /api/wave/push-transaction posts a
// CATEGORIZED bank transaction to Wave (anchor = silo deposit account, line = the assigned category),
// gated exactly like push-payment, dry-run-able, idempotent. The Sync Center now lists categorized bank
// txns as pushable (not "Hub-only"), and the misleading message is corrected.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/push-transaction/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: route calls Wave moneyTransactionCreate (the live-verified mutation), gated + placeholder-guarded + dry-run',
  /moneyTransactionCreate\(input:\$input\)\{ didSucceed inputErrors\{ message code path \} transaction\{ id \} \}/.test(route) &&
  /assertPermission\(db, by, 'wave\.payments\.push', req\)/.test(route) &&
  /if \(!_isApprovedTest && !_prodUnlocked\)/.test(route) &&
  /isPlaceholderWaveBusiness\(waveBusinessId\)/.test(route) &&
  /if \(isDry\) \{[\s\S]{0,700}return NextResponse\.json\(\{ ok: true, dry_run: true, anchor_account:[\s\S]{0,200}would_send: input/.test(route));
ok('2: VALID Wave payload (v55.83-MR) — anchor names the bank; lineItems carry ONLY the category (bank NOT duplicated, or Wave rejects with MULTIPLE_POSSIBLE_ANCHORS); category CREDIT on deposit / DEBIT on withdrawal',
  /anchor: \{ accountId: anchorAcct, amount: amtStr, direction: dir \}/.test(route) &&
  /lineItems: lineItems/.test(route) &&
  /function buildMoneyTxnLineItems\(direction, bankAcctId, categoryAcctId, amtStr\)/.test(route) &&
  /return \[\{ accountId: categoryAcctId, amount: amtStr, balance: 'CREDIT' \}\]/.test(route) &&
  /return \[\{ accountId: categoryAcctId, amount: amtStr, balance: 'DEBIT' \}\]/.test(route) &&
  // the bank account must NOT appear in lineItems (that caused MULTIPLE_POSSIBLE_ANCHORS); old INCREASE shape gone
  !/accountId: bankAcctId, amount: amtStr, balance:/.test(route) &&
  !/balance: 'INCREASE' \}\]/.test(route) &&
  /var dir = \(bt\.direction === 'in'[\s\S]{0,80}\? 'DEPOSIT' : 'WITHDRAWAL'/.test(route));
ok('3: requires a category + a resolved Wave bank anchor (per-account); blocks matched deposits (push as payments)',
  /No Wave category assigned/.test(route) &&
  /Could not resolve the Wave bank account for this transaction/.test(route) &&
  /it reaches Wave as an invoice PAYMENT/.test(route));
ok('4: Lane B push model — FRESH externalId per push (re-pushable when Max changes the category), claim syncing without blocking already-synced, duplicate-externalId => already-in-wave, success => synced',
  /var externalId = pushExternalId\(hubId\)/.test(route) &&
  /update\(\{ category_status: 'syncing' \}\)\.eq\('id', hubId\)/.test(route) &&
  /already_in_wave: true/.test(route) &&
  /category_status: 'synced'/.test(route));
ok('5: Sync Center makes a CATEGORIZED bank txn pushable (action transaction, not hubOnly); uncategorized stays Hub-only',
  /var hasCat = !!bt\.wave_account_id;/.test(sync) &&
  /key: 'banktxn:' \+ bt\.id, action: 'transaction'/.test(sync) &&
  /hubOnly: !hasCat/.test(sync));
ok('6: push dispatch routes transaction -> /api/wave/push-transaction + one-at-a-time books safety',
  /q\.action === 'transaction' \? '\/api\/wave\/push-transaction'/.test(sync) &&
  /var selectedBooks = selectedRows\.filter\(function \(q\) \{ return q\.action === 'payment' \|\| q\.action === 'transaction'; \}\)/.test(sync));
ok('7: the misleading "Wave\'s API can\'t accept transaction pushes" message is GONE',
  !/Wave's API does not accept transaction pushes/.test(sync) &&
  !/Wave's API can't accept raw transaction\/category pushes/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KZ push-transaction tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
