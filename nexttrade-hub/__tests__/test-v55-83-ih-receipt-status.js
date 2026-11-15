// ============================================================
// v55.83-IH — shared inventory receipt-status filter (Overview + Report Center).
//
// Both screens excluded cancelled/pending_detail/merged/reversed receipts, but each had its
// own inline copy — the drift that caused the GX Overview-vs-Report mismatch. Extracted to
// lib/inventory-receipts.isCountableReceipt() and imported in both.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// Load the helper (ESM → strip exports + eval).
var libSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'inventory-receipts.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(libSrc.replace(/export\s+/g, ''));

// ---- 1. predicate ----
ok('1a: finalized counts', isCountableReceipt({ status: 'finalized' }) === true);
ok('1b: active counts', isCountableReceipt({ status: 'active' }) === true);
ok('1c: received counts', isCountableReceipt({ status: 'received' }) === true);
ok('1d: cancelled excluded', isCountableReceipt({ status: 'cancelled' }) === false);
ok('1e: pending_detail excluded', isCountableReceipt({ status: 'pending_detail' }) === false);
ok('1f: merged excluded', isCountableReceipt({ status: 'merged' }) === false);
ok('1g: reversed excluded', isCountableReceipt({ status: 'reversed' }) === false);
ok('1h: missing status = countable (legacy)', isCountableReceipt({ quantity: 5 }) === true);
ok('1i: null row not countable', isCountableReceipt(null) === false);
ok('1j: INVALID list is exactly the 4 statuses', INVALID_RECEIPT_STATUSES.slice().sort().join(',') === ['cancelled', 'merged', 'pending_detail', 'reversed'].join(','));

// ---- 2. both screens import + use the shared helper ----
var ov = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryOverview.jsx'), 'utf8');
var rc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryReportCenter.jsx'), 'utf8');
ok('2a: Overview imports isCountableReceipt', /import \{ isCountableReceipt \} from '\.\.\/lib\/inventory-receipts'/.test(ov));
ok('2b: Overview stock aggregation uses isCountableReceipt', /if \(!isCountableReceipt\(r\)\) return;/.test(ov));
ok('2c: ReportCenter imports isCountableReceipt', /import \{ isCountableReceipt \} from '\.\.\/lib\/inventory-receipts'/.test(rc));
ok('2d: ReportCenter receipt loop uses isCountableReceipt', /if \(!isCountableReceipt\(r\)\) \{ return; \}/.test(rc));
ok('2e: neither screen still hard-codes the 4-status inline filter',
  ov.indexOf("r.status === 'cancelled' || r.status === 'pending_detail' || r.status === 'merged' || r.status === 'reversed'") === -1 &&
  rc.indexOf("r.status === 'cancelled' || r.status === 'pending_detail' || r.status === 'merged' || r.status === 'reversed'") === -1);

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IH receipt-status tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
