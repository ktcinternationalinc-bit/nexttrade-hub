// ============================================================
// v55.83-LW — Max: transaction push has failed ~20× with the SAME generic "No Wave bank account
// configured" — we kept guessing. Now the route SELF-DIAGNOSES why the anchor is missing so the Sync Log
// states the exact cause: (a) settings READ errored → the default_payment_account_id column is missing
// (run the ALTER TABLE), (b) no settings row → never saved, (c) row exists but empty → save failed / never
// picked. Plus a canonical SQL migration for the columns that previously had no migration file.
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
var lib = rd('src/lib/wave-bank-account-resolver.js');

ok('1: the precise unresolved-anchor reasons live in the shared resolver (no-mask-match in a multi-account silo vs no Wave bank account in the chart)',
  /if \(txnMask && waveBankAccts\.length > 1\) \{ why =/.test(lib) &&
  /else if \(waveBankAccts\.length === 0\) \{ why =/.test(lib) &&
  /if \(setRes && setRes\.error\) \{ why =/.test(route));
ok('2: the column-missing branch points the admin at the canonical migration to run',
  /the default_payment_account_id column may be missing — run the migration sql\/v55-83-LW-payment-account-columns\.sql/.test(route) &&
  /ALTER TABLE wave_business_settings ADD COLUMN IF NOT EXISTS default_payment_account_id text/.test(rd('sql/v55-83-LW-payment-account-columns.sql')));
ok('3: the diagnosis is surfaced via blocked() so it lands in the Sync Log (not a silent generic message)',
  /return blocked\('Could not resolve the Wave bank account for this transaction: ' \+ why, 400\);/.test(route));
ok('4: the bank transaction details are logged on a blocked push (txCtx) for easy review — Max\'s "list the exact transaction" ask',
  /txCtx = bankTxnLogContext\(bt\);/.test(route) &&
  /request_payload: txCtx/.test(route) &&
  /description: String\(bt\.name \|\| bt\.merchant_name/.test(route));
ok('5: a canonical SQL migration now exists for the payment-account columns (was a manual ALTER with no file)',
  exists('sql/v55-83-LW-payment-account-columns.sql') &&
  /ADD COLUMN IF NOT EXISTS default_payment_account_id text/.test(rd('sql/v55-83-LW-payment-account-columns.sql')) &&
  /ADD COLUMN IF NOT EXISTS default_payment_account_name text/.test(rd('sql/v55-83-LW-payment-account-columns.sql')));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LW deposit-anchor-diagnosis tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
