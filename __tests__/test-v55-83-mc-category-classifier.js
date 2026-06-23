// ============================================================
// v55.83-MC — category-type safety classifier (Codex). A money-transaction's CATEGORY (the non-bank leg)
// must not be a bank/cash account (that's the anchor), A/R or A/P (invoice/bill lanes), or a Wave system
// account. Normal income/expense are fine. This is a REAL behavior test — it imports the lib and calls it.
// ============================================================
var path = require('path');
var url = require('url');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
(async function () {
  var libUrl = url.pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'wave-bank-account-resolver.js')).href;
  var lib = await import(libUrl);
  var classify = lib.classifyWaveAccount;
  var safety = lib.categoryPushSafety;

  ok('1: classifies a Cash & Bank account as bank_cash',
    classify({ type: 'ASSET', subtype: 'CASH_AND_BANK', wave_account_name: 'PLAT BUS CHECKING (338)' }) === 'bank_cash');
  ok('2: classifies Accounts Receivable / Payable',
    classify({ type: 'ASSET', subtype: 'RECEIVABLE', wave_account_name: 'Accounts Receivable' }) === 'receivable' &&
    classify({ type: 'LIABILITY', subtype: 'PAYABLE', wave_account_name: 'Accounts Payable' }) === 'payable');
  ok('3: classifies normal income + expense',
    classify({ type: 'INCOME', subtype: 'INCOME', wave_account_name: 'Sales' }) === 'income' &&
    classify({ type: 'EXPENSE', subtype: 'OPERATING_EXPENSE', wave_account_name: 'Office Supplies' }) === 'expense');
  ok('4: classifies a system account + a contra-asset (Accumulated Depreciation)',
    classify({ type: 'EQUITY', subtype: 'BUSINESS_OWNER_CONTRIBUTION', wave_account_name: 'Retained Earnings' }) === 'system' &&
    classify({ type: 'ASSET', subtype: 'PROPERTY_PLANT_EQUIPMENT', wave_account_name: 'Accumulated Depreciation' }) === 'contra_asset');

  ok('5: BLOCKS bank/cash, A/R, A/P, system as a money-transaction category',
    safety({ subtype: 'CASH_AND_BANK', wave_account_name: 'Checking' }).block === true &&
    safety({ subtype: 'RECEIVABLE', wave_account_name: 'Accounts Receivable' }).block === true &&
    safety({ subtype: 'PAYABLE', wave_account_name: 'Accounts Payable' }).block === true &&
    safety({ type: 'EQUITY', wave_account_name: 'Opening Balance Equity' }).block === true);
  ok('6: ALLOWS normal expense + income (no block)',
    safety({ type: 'EXPENSE', wave_account_name: 'Bank Fees' }).block === false &&
    safety({ type: 'INCOME', wave_account_name: 'Consulting Income' }).block === false);
  ok('7: contra-asset (depreciation) is allowed but WARNED (unusual for a cash transaction)',
    safety({ type: 'ASSET', wave_account_name: 'Accumulated Depreciation' }).block === false &&
    typeof safety({ type: 'ASSET', wave_account_name: 'Accumulated Depreciation' }).warn === 'string');

  console.log('');
  if (failures.length === 0) { console.log('✅ All v55.83-MC category-classifier tests passed'); process.exit(0); }
  else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
})().catch(function (e) { console.log('❌ test crashed: ' + (e && e.stack || e)); process.exit(1); });
