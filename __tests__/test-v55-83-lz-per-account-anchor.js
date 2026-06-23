// ============================================================
// v55.83-LZ (refactored at MC) — PER-ACCOUNT anchor resolution. The blanket multi-account block is gone; a
// txn anchors to ITS OWN bank account's Wave account by mask. At MC the resolution moved into the SHARED lib
// src/lib/wave-bank-account-resolver.js, and push-transaction DELEGATES to it. This test asserts both: the
// route reads the txn's mask + delegates to the shared resolver, and the lib carries the resolution logic.
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
var lib = rd('src/lib/wave-bank-account-resolver.js');

ok('1: route reads THIS transaction\'s bank mask from plaid_accounts (per-account, not just a global setting)',
  /if \(bt\.account_id\) \{[\s\S]{0,160}from\('plaid_accounts'\)\.select\('mask'\)\.eq\('plaid_account_id', bt\.account_id\)/.test(route) &&
  /txnMask =/.test(route));
ok('2: route delegates to the shared resolver with the silo\'s bank/cash candidates (lib excludes A/R, A/P)',
  /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/wave-bank-account-resolver'/.test(route) &&
  /waveBankCashCandidates\(allCats\)/.test(route) &&
  /resolveWaveBankAnchor\(\{ waveBankAccts: bankCandidates/.test(route) &&
  /RECEIVABLE/.test(lib) && /PAYABLE/.test(lib) && /export function waveBankCashCandidates/.test(lib));
ok('3: mask match in the lib is suffix-tolerant (Wave "338" vs Plaid "6338")',
  /export function maskMatches\(waveName, mask\)/.test(lib) &&
  /m\.slice\(-t\.length\) === t/.test(lib));
ok('4: lib anchor order = matched-by-mask -> only-wave-bank-account -> silo-default, then diagnose',
  /'matched-by-mask:'/.test(lib) &&
  /waveBankAccts\.length === 1\) \{ return \{ acct: waveBankAccts\[0\]\.wave_account_id[\s\S]{0,120}'only-wave-bank-account'/.test(lib) &&
  /if \(globalAcct\) \{[\s\S]{0,800}'silo-default'/.test(lib));
ok('5: the old hard "multi-account silo" block is GONE from the route (resolver replaces it)',
  !/distinct bank accounts, but a transaction can only safely anchor to ONE Wave bank account/.test(route) &&
  !/var distinctAccts = Object\.keys\(canonKeys\)\.length;/.test(route));
ok('6: lib returns a precise reason when nothing resolves (no mask match among N / no Cash&Bank in chart)',
  /none of the ' \+ waveBankAccts\.length \+ ' Wave bank accounts has a name matching it/.test(lib) &&
  /no Wave Cash & Bank account exists in this business/.test(lib) &&
  /return blocked\('Could not resolve the Wave bank account for this transaction: ' \+ why/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LZ per-account-anchor tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
