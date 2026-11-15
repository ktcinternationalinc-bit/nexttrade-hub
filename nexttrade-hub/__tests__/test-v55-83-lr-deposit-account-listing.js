// ============================================================
// v55.83-LR — Max: deposit-account picker said "Found 200 accounts" but 0 were usable, so the transaction
// push stayed blocked ("No Wave bank account configured"). ROOT CAUSE: listAccounts fetched only page 1
// (pageSize 200), so on a chart with >200 accounts the real Cash/Bank account was past the cutoff and never
// seen. Fix: paginate ALL pages, detect cash/bank by subtype OR (asset + bank-ish name), skip archived,
// and the UI reports how many are actually usable.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/payment-account-setup/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: listAccounts paginates ALL pages (pageInfo.totalPages loop) instead of only page 1 / pageSize 200',
  /accounts\(page:\$page,pageSize:100\)\{ pageInfo\{ currentPage totalPages \}/.test(route) &&
  /if \(guard < 50 && pi\.totalPages && page < pi\.totalPages\) \{ page\+\+; return loop\(\); \}/.test(route) &&
  !/accounts\(page:1,pageSize:200\)/.test(route));
ok('2: cash/bank detection broadened — subtype OR (asset + bank-ish name), excludes receivable/payable, skips archived',
  /var subtypeCashBank = \(stU\.indexOf\('CASH_AND_BANK'\) >= 0/.test(route) &&
  /var nameCashBank = \(nmU\.indexOf\('CASH'\) >= 0 \|\| nmU\.indexOf\('BANK'\) >= 0/.test(route) &&
  /var payable = \(subtypeCashBank \|\| \(tyU\.indexOf\('ASSET'\) >= 0 && nameCashBank\)\) && !isReceivableOrPayable;/.test(route) &&
  /if \(!n \|\| n\.isArchived === true\) \{ continue; \}/.test(route));
ok('3: the UI reports how many of the found accounts are actually USABLE (and what to do if 0)',
  /' usable bank\/cash\)\. Pick the bank\/cash account/.test(sync) &&
  /create a "Cash on Hand" in Wave/.test(sync));
ok('4: route marker is a v55.83 payment-account-setup build (bump-tolerant) so the deployed fix is provable live',
  /var API_BUILD_MARKER = 'v55\.83-L[A-Z]-payment-account-setup';/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LR deposit-account-listing tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
