// v55.83-A.6.9 (Max May 13 2026) — Placeholder visibility, expected_date,
// write-offs report.
//
// Covers:
//   1. Placeholder rows show with amber treatment + expected_amount displayed
//   2. Treasury total includes placeholder expected_amount
//   3. Confirmed + pending breakdown shown below total when placeholders exist
//   4. Auto-matcher uses expected_date if set + 14-day window (vs 2-day)
//   5. handleAddPayment captures expected_date from formData
//   6. WriteOffsReport component exists with detail / by_customer / by_user views
//   7. Auto-suggest write-off button hidden when pending bank confirmation exists
//   8. Write-offs report wired into Reports tab

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var wor = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'WriteOffsReport.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Placeholder visual treatment
ok('1a: placeholder rows rendered with distinct amber background',
  /txn\.is_bank_placeholder \?[\s\S]{0,800}bg-amber-50/.test(page));
ok('1b: placeholder shows expected_amount, not cash_in',
  /txn\.is_bank_placeholder[\s\S]{0,1500}fE\(Number\(txn\.expected_amount \|\| 0\)\)/.test(page));
ok('1c: placeholder label includes "Awaiting bank confirmation" bilingual',
  /Awaiting bank confirmation[\s\S]{0,100}في انتظار تأكيد البنك/.test(page));
ok('1d: placeholder shows expected_date if different from transaction_date',
  /txn\.expected_date && txn\.expected_date !== txn\.transaction_date[\s\S]{0,200}Expected to clear/.test(page));

// 2. Treasury total includes placeholder expected_amount
ok('2a: total reducer adds placeholder expected_amount',
  /pending = t\.is_bank_placeholder \? Number\(t\.expected_amount \|\| 0\) : 0/.test(page));

// 3. Confirmed + pending breakdown shown when placeholders exist
ok('3a: confirmed/pending breakdown rendered when any placeholder present',
  /some\(t => t\.is_bank_placeholder\)/.test(page) &&
  /Confirmed.{0,40}مؤكد/.test(page) &&
  /Pending bank confirmation.{0,80}في انتظار البنك/.test(page));

// 4. Auto-matcher window expanded + uses expected_date
ok('4a: auto-matcher uses expected_date with transaction_date fallback',
  /anchorDate = new Date\(ph\.expected_date \|\| ph\.transaction_date\)/.test(page));
ok('4b: match window is 14 days (was 2)',
  /matchWindow = 14 \* 86400000/.test(page));
ok('4c: scoring uses anchorDate not phDate',
  /Math\.abs\(new Date\(b\.date\) - anchorDate\)/.test(page));

// 5. handleAddPayment captures expected_date
ok('5a: placeholder creation sets expected_date from formData',
  /record\.expected_date = formData\.expectedDate \|\| record\.transaction_date/.test(page));

// 6. WriteOffsReport component features
ok('6a: WriteOffsReport component file exists and exports default',
  /export default function WriteOffsReport/.test(wor));
ok('6b: queries audit_log for write_off and write_off_reverse actions',
  /\.in\('action', \['write_off', 'write_off_reverse'\]\)/.test(wor));
ok('6c: three views available: detail, by_customer, by_user',
  /useState\('detail'\)[\s\S]{0,2000}by_customer[\s\S]{0,3000}by_user/.test(wor));
ok('6d: summary cards show total, reversed, net, override count',
  /Total written off[\s\S]{0,800}Reversals[\s\S]{0,300}Net loss[\s\S]{0,300}Cap overrides/.test(wor));
ok('6e: CSV export function defined',
  /(var|const) exportCsv = function/.test(wor));
ok('6f: filters: date range, customer, approver',
  /setDateFrom[\s\S]{0,400}setDateTo[\s\S]{0,400}setFilterCustomer[\s\S]{0,400}setFilterUser/.test(wor));
ok('6g: cap-override badge shown on detail rows',
  /soft_cap_overridden[\s\S]{0,300}CAP OVERRIDE/.test(wor));
ok('6h: bilingual UI throughout',
  /تقرير الخصومات/.test(wor) && /تجاوزات/.test(wor) && /حسب العميل/.test(wor));

// 7. Auto-suggest write-off guarded by pending bank confirmation
ok('7a: write-off prompt hidden if total_pending_bank > 0',
  /selectedInvoice\.outstanding <= WRITE_OFF_SOFT_CAP_EGP[\s\S]{0,200}Number\(selectedInvoice\.total_pending_bank \|\| 0\) === 0/.test(page));

// 8. Reports tab wires in WriteOffsReport
ok('8a: WriteOffsReport imported in page.jsx',
  /import WriteOffsReport from '\.\.\/components\/WriteOffsReport'/.test(page));
ok('8b: rendered inside Reports tab section',
  /<WriteOffsReport[\s\S]{0,400}invoices=\{invoices\}/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.9 tests passed');
