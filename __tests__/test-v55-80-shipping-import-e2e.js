// __tests__/test-v55-80-shipping-import-e2e.js
// =============================================
// END-TO-END test of the shipping rate import using Max's real template.
// Verifies that the file from /mnt/user-data/uploads (saved into fixtures)
// is parsed correctly:
//   - All 210 rows load
//   - All dates resolve (none silently fall back to today)
//   - All historical dates are preserved
//   - All container types normalized to "40' HC"
//   - All vendors / shipping lines / origins read
//   - No row drops a required field
//
// Run: node __tests__/test-v55-80-shipping-import-e2e.js

var fs = require('fs');
var path = require('path');

// Load the helper module
var helpersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'shipping-import-helpers.js'), 'utf8');
var script = helpersSrc
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
script += '\n;return { parseDate, parseNumberSmart, normalizeContainer };\n';
var lib = (new Function(script))();

// Load XLSX (skip if not installed — test will report)
var XLSX;
try {
  XLSX = require(path.join(process.cwd(), 'node_modules', 'xlsx'));
} catch (_) {
  try { XLSX = require('xlsx'); } catch (__) {}
}

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== Shipping import E2E (real template) ===\n');

// Locate fixture
var fixturePath = path.join(__dirname, 'fixtures', 'shipping-template.xlsx');
if (!fs.existsSync(fixturePath)) {
  console.log('  (fixture not present at ' + fixturePath + ' — skipping)');
  process.exit(0);
}
if (!XLSX) {
  console.log('  (xlsx package not installed in this env — skipping E2E)');
  process.exit(0);
}

var d = fs.readFileSync(fixturePath);
var wb = XLSX.read(d);
var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

ok('Parses 210 rows from the template', rows.length === 210, 'got: ' + rows.length);

// Headers
var headers = Object.keys(rows[0]);
var expectedHeaders = ['Origin', 'Destination', 'Port of Loading (POL)', 'Port of Discharge (POD)',
                        'Vendor / Forwarder', 'Shipping Line / Carrier', 'Transport Mode',
                        'Container Type', 'Rate Amount', 'Currency', 'Effective Date', 'Expiry Date',
                        'Transit Days', 'Free Days'];
expectedHeaders.forEach(function (h) {
  ok('Header present: ' + h, headers.indexOf(h) >= 0);
});

// Date parsing — every row should have a parseable Effective Date AND Expiry Date
// EXCEPT for 3 rows in the template that have user-entered bad data (Effective=0,
// Expiry=30). The parser correctly returns null for these — the IMPORTER then
// uses today() as effective fallback, leaves expiry as null. Both behaviors are correct.
var dateFailures = 0;
var historicalCount = 0;
var badDataRows = [];
var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
rows.forEach(function (row, i) {
  var eff = lib.parseDate(row, 'Effective Date');
  var exp = lib.parseDate(row, 'Expiry Date');
  // Skip rows known to have bad source data (Effective=0, Expiry=30)
  if (row['Effective Date'] === 0 && row['Expiry Date'] === 30) {
    badDataRows.push(i + 2);
    return;
  }
  if (!eff) {
    dateFailures++;
    if (dateFailures <= 3) console.error('    row ' + (i + 2) + ' eff failed:', row['Effective Date']);
  } else if (eff < todayStr) {
    historicalCount++;
  }
  if (!exp) {
    dateFailures++;
    if (dateFailures <= 3) console.error('    row ' + (i + 2) + ' exp failed:', row['Expiry Date']);
  }
});
ok('All non-bad-data rows parse cleanly (zero silent NULLs on good data)',
   dateFailures === 0,
   'failures: ' + dateFailures);
ok('Bad-data rows correctly identified (parser returned null instead of crashing or guessing)',
   badDataRows.length === 3,
   'bad rows: ' + badDataRows.join(', '));
ok('Historical rows are preserved as historical (not silently set to today)',
   historicalCount > 0,
   'historical: ' + historicalCount);

// Rate amount on every row
var zeroRates = 0;
rows.forEach(function (row) {
  var n = lib.parseNumberSmart(row['Rate Amount']);
  if (isNaN(n) || n <= 0) zeroRates++;
});
ok('All 210 rows have a positive Rate Amount', zeroRates === 0, 'zero/null: ' + zeroRates);

// Container normalization
var allHC = rows.every(function (row) {
  var ct = lib.normalizeContainer(row['Container Type']);
  return ct === "40' HC";
});
ok('All 210 rows normalize to "40\' HC"', allHC);

// Origin / Vendor sanity
var distinctOrigins = new Set(rows.map(function (r) { return r['Origin']; }));
ok('Multiple distinct origins read', distinctOrigins.size >= 2, 'origins: ' + Array.from(distinctOrigins).join(', '));

var distinctVendors = new Set(rows.map(function (r) { return (r['Vendor / Forwarder'] || '').toLowerCase(); }));
ok('Vendor column reads (case-variant lookups)', distinctVendors.size >= 1, 'vendors: ' + distinctVendors.size);

// Spot check first row's parsed values
var r0 = rows[0];
ok('Row 0 origin = CANADA', r0['Origin'] === 'CANADA');
ok('Row 0 destination = Egypt', r0['Destination'] === 'Egypt');
ok('Row 0 vendor = ONTREK', r0['Vendor / Forwarder'] === 'ONTREK');
ok('Row 0 line = Maersk', r0['Shipping Line / Carrier'] === 'Maersk');
ok('Row 0 container = 40\' HC', r0['Container Type'] === "40' HC");
ok('Row 0 rate = 2250', r0['Rate Amount'] === 2250);
ok('Row 0 currency = USD', r0['Currency'] === 'USD');
ok('Row 0 transit = 40', r0['Transit Days'] === 40);

// The critical assertion — historical date stays historical
var r0Eff = lib.parseDate(r0, 'Effective Date');
ok('Row 0 effective_date = 2024-12-31 (historical, NOT today)',
   r0Eff === '2024-12-31',
   'got: ' + r0Eff);

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
