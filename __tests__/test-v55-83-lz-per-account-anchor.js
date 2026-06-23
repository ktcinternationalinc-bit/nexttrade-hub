// ============================================================
// v55.83-LZ — Codex architecture FAIL: the push forced ONE global Wave deposit account and HARD-BLOCKED
// multi-account silos. Real fix: resolve the bank-side anchor PER TRANSACTION — match the txn's own bank
// account (by mask, suffix-tolerant for Wave "(338)" vs Plaid "6338") to its Wave bank account; if the silo
// has exactly one Wave bank account use it; else fall back to the silo default. No more multi-account block.
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

ok('1: reads THIS transaction\'s bank mask from plaid_accounts (per-account, not just a global setting)',
  /if \(bt\.account_id\) \{[\s\S]{0,160}from\('plaid_accounts'\)\.select\('mask'\)\.eq\('plaid_account_id', bt\.account_id\)/.test(route) &&
  /txnMask =/.test(route));
ok('2: builds the silo\'s Wave bank/cash accounts from wave_categories (excludes A/R, A/P)',
  /var waveBankAccts = \[\];/.test(route) &&
  /from\('wave_categories'\)\.select\('wave_account_id, wave_account_name, subtype, type'\)/.test(route) &&
  /if \(isBank && !arap && c\.wave_account_id\) \{ waveBankAccts\.push\(c\); \}/.test(route));
ok('3: mask match is suffix-tolerant (Wave "338" vs Plaid "6338")',
  /function maskMatches\(waveName, mask\)/.test(route) &&
  /mask\.slice\(-t\.length\) === t/.test(route));
ok('4: anchor resolution order = matched-by-mask -> only-wave-bank-account -> silo-default, then diagnose',
  /anchorVia = 'matched-by-mask:'/.test(route) &&
  /waveBankAccts\.length === 1\) \{ anchorAcct = waveBankAccts\[0\]\.wave_account_id[\s\S]{0,80}'only-wave-bank-account'/.test(route) &&
  /!anchorAcct && globalAcct\) \{ anchorAcct = globalAcct[\s\S]{0,60}'silo-default'/.test(route));
ok('5: the old hard "multi-account silo" block is GONE (per-account resolution replaces it)',
  !/distinct bank accounts, but a transaction can only safely anchor to ONE Wave bank account/.test(route) &&
  !/var distinctAccts = Object\.keys\(canonKeys\)\.length;/.test(route));
ok('6: still blocks with a precise reason when nothing resolves (no match in a multi-account silo / no chart bank account)',
  /none of the ' \+ waveBankAccts\.length \+ ' Wave bank accounts has a name matching it/.test(route) &&
  /no Wave Cash & Bank account exists in this business/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LZ per-account-anchor tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
