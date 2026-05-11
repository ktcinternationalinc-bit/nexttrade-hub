// __tests__/test-v55-82-qa21-red-contrast.js
// =============================================================
// v55.82 QA-21 (Max May 9 2026)
//
// Photo evidence from Max showed unreadable red text on a light-red
// pill background in the Audit Log — specifically:
//   - "73 Late Edits Detected" header (text-red-700 on bg-red-50)
//   - subtitle "Changes made 24+ hours after original entry"
//     (text-red-600 at text-[10px])
//   - "LATE EDIT (73h)" pill (text-red-700 on bg-red-100 at text-[9px])
//
// My v55.81 QA-6 contrast sweep missed these because the regex was
// looking for amber-on-amber and yellow-on-yellow specifically. This
// test adds a regression guard for red AND rose on light backgrounds.
//
// Also catches: a duplicate UPDATE/CREATE/DELETE label rendered twice
// in the audit row (pre-existing bug; line 1339 vs 1341 in AdminTab).
// =============================================================

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var COMPONENTS = path.join(ROOT, 'src/components');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

var failures = [];
function ok(name, cond) {
  if (cond) { console.log('  ✓', name); }
  else { failures.push(name); console.log('  ✗', name); }
}

console.log('QA-21: red/rose contrast on light backgrounds');

// Targeted fixes
var admin = read('src/components/AdminTab.jsx');
ok('Late Edits banner header uses text-red-900 (was text-red-700)',
  /text-sm font-extrabold text-red-900">🚨 \{lateEdits\.length\} Late Edit/.test(admin));
ok('Late Edits banner subtitle uses text-red-800 + font-semibold (was text-red-600 at 10px)',
  /text-\[11px\] text-red-800 font-semibold mt-0\.5">Changes made 24\+ hours/.test(admin));
ok('Late Edits banner border bumped to red-300 (was red-200)',
  /border-2 border-red-300 rounded-xl/.test(admin));
ok('LATE EDIT pill uses text-red-900 + border (was text-red-700 no border)',
  /bg-red-100 text-red-900 text-\[9px\] font-extrabold border border-red-300">🚨 LATE EDIT/.test(admin));
ok('AUTO TIMEOUT pill uses text-red-900 + border (was text-red-600 no border)',
  /bg-red-50 text-red-900 rounded text-\[9px\] font-bold border border-red-300">AUTO TIMEOUT/.test(admin));
ok('Audit "Late Edits" filter button (inactive) uses text-red-900 + border',
  /'bg-red-50 text-red-900 border border-red-200'\)\}>🚨 Late Edits/.test(admin));
ok('Audit "Sensitive" filter button (inactive) uses text-amber-900 + border',
  /'bg-amber-50 text-amber-900 border border-amber-200'\)\}>⚠️ Sensitive/.test(admin));
ok('QA-21 marker present in AdminTab',
  admin.indexOf('QA-21') !== -1);

// Duplicate UPDATE label fix (pre-existing bug)
ok('Duplicate action-label pill removed from audit row',
  // Count occurrences of the pattern in the row render area — should be ONE
  (admin.match(/<span className=\{'font-bold ' \+ \(actionColors\[a\.action\] \|\| ''\)\}>\{\(a\.action\|\|''\)\.toUpperCase\(\)\}<\/span>/g) || []).length === 1);

// Other fixes
var quotes = read('src/components/QuotesTab.jsx');
ok('QuotesTab EXPIRED pill uses text-red-900 + border',
  /bg-red-100 text-red-900 border border-red-300">EXPIRED/.test(quotes));
ok('QuotesTab Delete buttons use text-red-800 + border',
  /bg-red-50 text-red-800 rounded text-\[10px\] font-semibold border border-red-200">Delete/.test(quotes));

var ship = read('src/components/ShippingRatesTab.jsx');
ok('ShippingRatesTab expired-rate badge uses text-red-900 + border',
  /'bg-red-100 text-red-900 border border-red-300'/.test(ship));

var ticks = read('src/components/TicketsTab.jsx');
ok('TicketsTab red badges use text-red-800 + border',
  /bg-red-50 text-red-800 border border-red-200/.test(ticks));

var phone = read('src/components/PhoneWidget.jsx');
ok('PhoneWidget error banner uses text-red-900 + border',
  /bg-red-50 text-red-900 text-\[10px\] p-2 border border-red-200/.test(phone));

var settings = read('src/components/SettingsTab.jsx');
ok('SettingsTab access/disabled badges use text-red-900 + border',
  /'bg-red-100 text-red-900 border border-red-300'/.test(settings));

// Whole-codebase regression guard
console.log('\nWhole-codebase regression guard');
var componentFiles = fs.readdirSync(COMPONENTS).filter(function (f) { return f.endsWith('.jsx'); });
var leftovers = 0;
var firstLeftover = '';
componentFiles.forEach(function (f) {
  var src = fs.readFileSync(path.join(COMPONENTS, f), 'utf8');
  src.split('\n').forEach(function (line, i) {
    // Truly unreadable: small text + red/rose-500/600 + on red/rose light bg + no border
    if (/text-\[(8|9|10)px\]/.test(line) &&
        /text-(red|rose)-(500|600)\b/.test(line) &&
        /bg-(red|rose)-(50|100)\b/.test(line) &&
        !/border-(red|rose)-/.test(line)) {
      leftovers++;
      if (!firstLeftover) firstLeftover = f + ':' + (i + 1);
    }
  });
});
ok('Zero red/rose-500/600 + light-bg + small-text combos remaining without a border',
  leftovers === 0);

console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' — ' + (15 - failures.length) + '/15 assertions');
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  if (firstLeftover) console.log('\nFirst leftover offender: ' + firstLeftover);
  process.exit(1);
}
