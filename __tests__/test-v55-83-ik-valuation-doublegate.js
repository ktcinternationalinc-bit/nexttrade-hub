// ============================================================
// v55.83-IK — valuation double-gate (defense-in-depth) in the Report Center.
//
// Display/export already MASK valuation columns as "Restricted" when the viewer
// lacks inventory.valuation.view. IK additionally STRIPS the underlying cost
// values (avg_cost, total_value) from the row objects at the flatRows()
// chokepoint, so the real numbers never travel in React props / payloads /
// exports. Display must be unchanged (masking keys off the column flag).
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var rc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryReportCenter.jsx'), 'utf8');
var defs = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'inventory-report-defs.js'), 'utf8');

// ---- 1. The columns being stripped are exactly the valuation-flagged ones ----
ok('1a: avg_cost is flagged valuation:true', /key: 'avg_cost'[^\n]*valuation: true/.test(defs));
ok('1b: total_value is flagged valuation:true', /key: 'total_value'[^\n]*valuation: true/.test(defs));

// ---- 2. stripValuation exists and is correct ----
ok('2a: stripValuation defined', /function stripValuation\(rows, cols\)/.test(rc));
ok('2b: returns rows unchanged when the viewer CAN see valuation',
  /function stripValuation\(rows, cols\) \{\s*if \(showValuation\) \{ return rows; \}/.test(rc));
ok('2c: derives the keys to strip from the column valuation flag',
  /\.filter\(function \(c\) \{ return c\.valuation; \}\)\.map\(function \(c\) \{ return c\.key; \}\)/.test(rc));
ok('2d: nulls each valuation key on a COPY of the row (no mutation of source)',
  /var copy = Object\.assign\(\{\}, r\);/.test(rc) && /valKeys\.forEach\(function \(k\) \{ copy\[k\] = null; \}\)/.test(rc));

// ---- 3. flatRows routes every consumer through stripValuation ----
ok('3a: flatRows applies stripValuation to the dispatched rows',
  /var rows = \(reportId === 'movement'\) \? movementRows\(\) : snapshotRows\(\);\s*return stripValuation\(rows, report && report\.columns\);/.test(rc));

// ---- 4. Display masking is still in place (so output is unchanged) ----
ok('4a: export still masks valuation cells as Restricted',
  /if \(c\.valuation && !showValuation\) \{ return isRtl \? 'مقيّد' : 'Restricted'; \}/.test(rc));
ok('4b: footer totals still skip valuation columns when gated',
  /if \(c\.total === 'sum' && !\(c\.valuation && !showValuation\)\)/.test(rc));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IK valuation double-gate tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
