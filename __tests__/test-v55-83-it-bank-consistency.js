// ============================================================
// v55.83-IT — bank data CONSISTENCY (Codex user-reported FAIL: same account/silo, different newest
// dates across Bank Tab vs Bank Review). Fixes: scope-by-silo BEFORE limit on BOTH screens, one
// canonical sort date (posted_date), and deep-link preserves the bank account context.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var br = rd('src/components/BankReviewTab.jsx');
var bt = rd('src/components/BankTab.jsx');

// 1. Bank Review scopes by active silo BEFORE the limit (no global-limit-before-scope)
ok('1a: Bank Review scopes bank_transactions by active wave_business_id at the query',
  /_txQRev = _txQRev\.eq\('wave_business_id', _activeBizRev\)/.test(br) && /_txQRev = _txQRev\.limit\(1000\)/.test(br));
ok('1b: Bank Review no longer uses a bare global limit(1000) before scoping',
  br.indexOf(".select('*').order('posted_date', { ascending: false, nullsFirst: false }).limit(1000)") === -1);

// 2. Both screens order by the SAME canonical date (posted_date)
ok('2a: Bank Review orders by posted_date', /_txQRev = supabase\.from\('bank_transactions'\)\.select\('\*'\)\.order\('posted_date'/.test(br));
ok('2b: Bank Tab orders by posted_date (matches Bank Review)', /_txq = supabase\.from\('bank_transactions'\)\.select\('\*'\)\.order\('posted_date'/.test(bt));
ok('2c: Bank Tab still scopes by active silo before its limit', /_txq = _txq\.eq\('wave_business_id', _activeBizScope\)/.test(bt));

// 3. Deep-link preserves the bank account context
ok('3a: deep-link sets fAccount to the txn account_id (not "all")',
  /setFAccount\(deepHit\.account_id \|\| 'all'\)/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-IT bank-consistency tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
