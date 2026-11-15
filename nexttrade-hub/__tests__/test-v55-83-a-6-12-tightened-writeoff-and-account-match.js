// v55.83-A.6.12 (Max May 13 2026) — Two fixes:
//   1. Write-off auto-suggest tightened: only shows when 90%+ already
//      collected. Permission-gated for >1000 overrides.
//   2. Auto-matcher: bank_account_id mismatch is score penalty, not
//      hard exclusion. Fixes invoice 2303's 570K placeholder not
//      matching its 570K bank entry.

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Write-off auto-suggest now requires 90% collected
ok('1a: write-off prompt requires 90%+ already collected',
  /total_collected[\s\S]{0,100}>= Number\(selectedInvoice\.total_amount \|\| 0\) \* 0\.90/.test(page));
ok('1b: prompt message says "Customer short-paid by X" (specific)',
  /Customer short-paid by[\s\S]{0,200}fE\(Number\(selectedInvoice\.outstanding\)\)/.test(page));
ok('1c: bilingual short-paid prompt has Arabic',
  /نقص دفع العميل/.test(page));

// 2. Super-admin override requires explicit module permission
ok('2a: super_admin override requires Write off discounts permission',
  /selectedInvoice\.outstanding > WRITE_OFF_SOFT_CAP_EGP[\s\S]{0,200}isSuperAdmin[\s\S]{0,200}modulePerms\?\.\['Write off discounts'\] === true/.test(page));

// 3. Auto-matcher: account_id mismatch is score penalty, not exclusion
ok('3a: bank_account_id check removed from candidate filter',
  !/if \(ph\.bank_account_id && b\.account_id && ph\.bank_account_id !== b\.account_id\) return false/.test(page),
  'should no longer hard-exclude on account mismatch');
ok('3b: bank_account_id mismatch now applied as score penalty in scored map',
  /ph\.bank_account_id && b\.account_id && ph\.bank_account_id !== b\.account_id[\s\S]{0,100}score -= 500/.test(page));
ok('3c: amount tolerance + date window guards preserved',
  /Math\.abs\(Math\.abs\(bankAmt\) - expAmt\) > tolAmt/.test(page) &&
  /matchWindow = 14 \* 86400000/.test(page));

// 4. Bug-context comment links to invoice 2303
ok('4a: code comment explains invoice 2303 bug context',
  /invoice 2303[\s\S]{0,200}570K placeholder/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.12 tests passed');
