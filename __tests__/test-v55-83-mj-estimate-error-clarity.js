// ============================================================
// v55.83-MJ - Estimates are optional and estimate import errors must not look
// like the main Wave import failed. The UI translates common failures and keeps
// raw details collapsed.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond) {
  if (cond) { console.log('OK ' + label); }
  else { failures.push(label); console.log('FAIL ' + label); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var imp = rd('src/components/WaveImportTab.jsx');
var page = rd('src/app/page.jsx');
var wn = rd('src/components/WhatsNewWidget.jsx');

ok('1: visible app build and changelog are MJ or newer',
  /v55\.83-M[A-Z]/.test(page) && /version: 'v55\.83-M[J-Q]'/.test(wn));
ok('2: estimate importer is explicitly optional and separate from the main Wave import path',
  /Optional - Wave Estimates -> Hub Proformas \(skip unless you use Wave Estimates\)/.test(imp) &&
  /separate from categories, bank matching, invoice-payment links, and Wave push/.test(imp));
ok('3: common estimate failures are translated into human guidance',
  /function estimateErrorHelp\(errors\)/.test(imp) &&
  /Wave did not expose Estimates/.test(imp) &&
  /proforma\/estimate database columns are missing/.test(imp) &&
  /Wave returned no estimate list/.test(imp));
ok('4: raw estimate errors are still available but collapsed',
  /What this means/.test(imp) &&
  /Technical error details/.test(imp) &&
  /estReport\.errors\.slice\(0, 20\)/.test(imp));

console.log('');
if (failures.length === 0) { console.log('All v55.83-MJ estimate clarity tests passed'); process.exit(0); }
else { console.log(failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
