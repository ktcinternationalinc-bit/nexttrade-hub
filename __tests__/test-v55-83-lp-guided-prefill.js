// ============================================================
// v55.83-MI - Wave-to-Hub import is now one guided Wave Import page.
// The old Sync Center import tab is retired; historical Wave transaction
// categorizations are imported from Wave's Transactions CSV with preview first.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('OK ' + label);
  else { failures.push(label + (hint ? ' - ' + hint : '')); console.log('FAIL ' + label + (hint ? ' - ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var imp = rd('src/components/WaveImportTab.jsx');

ok('1: Wave Import imports customers and invoices for the selected Wave business',
  /function runImportCustomers\(\)/.test(imp) &&
  /fetch\('\/api\/wave\/import-customers'[\s\S]{0,220}businessId: bizId/.test(imp) &&
  /function runImportInvoices\(\)/.test(imp) &&
  /fetch\('\/api\/wave\/import-invoices'[\s\S]{0,220}businessId: bizId/.test(imp));
ok('2: the page has a single Wave -> Hub import map',
  /Wave -> Hub import map/.test(imp) &&
  /Chart of Accounts/.test(imp) &&
  /Old transaction categories/.test(imp) &&
  /Invoice payments/.test(imp));
ok('3: prior Wave transaction categorizations are an explicit CSV workflow',
  /Step 3 - Import old Wave transaction categories/.test(imp) &&
  /Accounting &gt; Transactions &gt; Export/.test(imp) &&
  /function runCsvImport\(apply\)/.test(imp) &&
  /Preview CSV match/.test(imp));
ok('4: Wave invoice payment readback and prefill links live on Wave Import',
  /function runPaymentReadback\(\)/.test(imp) &&
  /function runPrefillLinks\(apply\)/.test(imp) &&
  /Step 6 - Pull Wave invoice payments and link deposits/.test(imp));
ok('5: payment link prefill stays preview-first',
  /Preview deposit links/.test(imp) &&
  /Apply links/.test(imp) &&
  /dry_run: !apply/.test(imp));

console.log('');
if (failures.length === 0) { console.log('All v55.83-MI guided import tests passed'); process.exit(0); }
else { console.log(failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
