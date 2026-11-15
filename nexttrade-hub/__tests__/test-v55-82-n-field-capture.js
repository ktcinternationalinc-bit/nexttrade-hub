// v55.82-N — Field-level capture diagnostic per Max May 12 2026 spec
// "Add validation showing which fields were imported, missing, or failed"
// "Add an import summary confirming field-level capture"

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

// Helper exists
ok('1: computeCaptureReport helper defined',
  /const computeCaptureReport = \(colMap, parsed, useContainerExpansion\) =>/.test(src));

// All 21 template fields appear in FIELD_SPEC array
var expectedFields = [
  'Origin', 'Destination', 'Port of Loading \\(POL\\)', 'Port of Discharge \\(POD\\)',
  'Vendor / Forwarder', 'Shipping Line / Carrier', 'Transport Mode', 'Container Type',
  'Rate Amount', 'Currency', 'Effective Date', 'Expiry Date',
  'Transit Days', 'Free Days', 'Port Fees', 'THC Fees',
  'Documentation Fees', 'Customs Fees', 'Other Fees', 'Other Fees Description', 'Notes'
];
var allFound = expectedFields.every(function(f) { return new RegExp("'" + f + "'").test(src); });
ok('2: All 21 template field labels in FIELD_SPEC',
  allFound,
  'every template column must have a row in the capture report');

// State declared
ok('3: importCaptureReport useState declared',
  /const \[importCaptureReport, setImportCaptureReport\] = useState\(\[\]\)/.test(src));

// Status classification covers ok / partial / empty / missing
ok('4: Capture status classified into ok / partial / empty / missing',
  /status = 'ok'/.test(src) && /status = 'partial'/.test(src) &&
  /status = 'empty'/.test(src) && /status = 'missing'/.test(src));

// Capture detection uses non-empty value check, not just column detection
ok('5: Capture count requires non-empty value per row',
  /parsed\.forEach\(function \(r\) \{[\s\S]{0,500}captured\+\+/.test(src));

// Numeric fields handle 0 as valid (not "missing")
ok('6: Numeric fields treat 0 as captured (not missing)',
  /numericFields = \{ rate_amount:1[\s\S]{0,200}\}/.test(src));

// computeCaptureReport called after parse in processImportFile
ok('7a: computeCaptureReport called after parse in processImportFile',
  /var captureReport = computeCaptureReport\(colMap, parsed, useContainerExpansion\)/.test(src));

// Also called in reparseFromMapping
ok('7b: computeCaptureReport called after reparse too',
  /setImportCaptureReport\(computeCaptureReport\(newColMap, parsed, useContainerExpansion\)\)/.test(src));

// UI: preview screen has the report panel
ok('8a: Preview screen renders Field Capture Report',
  /📋 Field Capture Report/.test(src));

// UI: status legend (OK/PARTIAL/EMPTY/MISSING)
ok('8b: Report shows status legend',
  /OK ≥90%/.test(src) && /PARTIAL 1–89%/.test(src) && /EMPTY \(no values\)/.test(src) && /MISSING \(no col\)/.test(src));

// UI: each field shows its detected source column
ok('8c: Each field shows source column name when detected',
  /from <code className="bg-white px-1 rounded">\{r\.sourceCol/.test(src));

// UI: each field shows captured/total ratio
ok('8d: Each field shows captured/total ratio',
  /r\.captured \+ '\/' \+ r\.total/.test(src));

// UI: actionable summary at the bottom
ok('8e: Summary at the bottom flags missing fields explicitly',
  /no detected source column/.test(src));

// UI: done screen has its own compact summary
ok('9: Done screen has compact field capture summary',
  /📋 Field capture summary/.test(src));

// Reset on Back button clears the report
ok('10a: Back button (top) resets importCaptureReport',
  /setImportContainerCols\(\[\]\);setImportCaptureReport\(\[\]\);}/.test(src));
ok('10b: Done screen Back button resets importCaptureReport',
  /setImportCounts\(\{added:0,updated:0,unchanged:0,failed:0,deleted:0\}\);setImportCaptureReport\(\[\]\)/.test(src));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-N capture-report tests passed');
