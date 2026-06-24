// ============================================================
// v55.83-MM — make Step 3 (import prior Wave categories) actually work with Wave's REAL export. Max's CSV
// (Reports → Account Transactions → Export) has: TWO rows per transaction (bank side + category side), the
// category in the "Other Accounts for this Transaction" column on the bank-side row, a correctly-SIGNED
// "Amount (One column)", and Debit/Credit in accounting convention (inverse of a bank statement). The
// importer used to pick "Account Name" as the category and double-count both rows. Fixes:
//  - detect "Other Accounts for this Transaction" as the category;
//  - process ONLY bank-side rows (Account Type = Cash and Bank);
//  - trust the signed Amount column for Wave GL exports (don't flip direction off Debit/Credit);
//  - skip Wave "Uncategorized Income/Expense" (not a real category).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/import-transaction-csv/route.js');

ok('1: detects the Wave "Other Accounts for this Transaction" column as the category (before the generic account fallback)',
  /category: findCol\(headers, \['other account', 'category'\], null\)/.test(route) &&
  /accountType: findCol\(headers, \['account type'\], null\)/.test(route) &&
  // the generic fallback now avoids name/type/group/id so it can never pick "Account Name"
  /findCol\(headers, \['account'\], \['bank', 'asset', 'checking', 'name', 'type', 'group', ' id', 'account id'\]\)/.test(route));
ok('2: processes ONLY the bank-side rows of a Wave accounting export (cash/bank Account Type) so the duplicate category-side row is skipped',
  /var isWaveAccountingExport = ci\.accountName >= 0 && ci\.accountType >= 0 && ci\.category >= 0/.test(route) &&
  /if \(isWaveAccountingExport\) \{/.test(route) &&
  /rAcctType\.indexOf\('cash'\) >= 0 \|\| rAcctType\.indexOf\('bank'\) >= 0\)\) \{ skippedNonBank\+\+; continue; \}/.test(route));
ok('3: skips Wave "Uncategorized Income/Expense" (nothing to import)',
  /if \(\/\^uncategor\/\.test\(norm\(cCat\)\)\) \{ skippedUncategorized\+\+; continue; \}/.test(route));
ok('4: for a Wave GL export, direction comes from the SIGNED amount column (not the inverted Debit/Credit)',
  /(isWaveAccountingExport|ci\.accountType >= 0) && ci\.amount >= 0\) \{ var aw = parseAmount\(rowArr\[ci\.amount\]\); if \(aw != null\) \{ return aw; \} \}/.test(route));
ok('5: the preview reports how many rows were skipped (non-bank duplicate + uncategorized)',
  /skipped_uncategorized_count: skippedUncategorized, skipped_non_bank_row_count: skippedNonBank/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MM wave-gl-csv-import tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
