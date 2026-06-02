// ============================================================
// v55.83-H regression — Inventory Overview
//   1. A CANCELLED receipt must NOT count toward Original Stock (or any
//      received total). Bug: LUX-BK showed Original 28,381 (18,381 received
//      + 10,000 cancelled) instead of 18,381.
//   2. Products within a family list largest amount first → lowest.
//
// The summation + sort logic lives inside a React useMemo, so we mirror the
// exact algorithm here and assert the behavior. The source is also checked so
// the test fails loudly if the component logic drifts from this contract.
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');

var fails = 0;
function ok(name, cond) { if (cond) { console.log('\u2713 ' + name); } else { console.log('\u2717 ' + name); fails++; } }

// ── Mirror of the receipts summation (cancelled excluded) ──
function summarize(receipts) {
  var s = { original_qty: 0, current_qty: 0, pending_qty: 0, has_finalized: false, has_pending: false };
  receipts.forEach(function (r) {
    if (r.status === 'cancelled') return;          // cancelled = deleted
    var q = Number(r.quantity || 0);
    s.original_qty += q;
    if (r.status === 'finalized') { s.has_finalized = true; }
    else { s.pending_qty += q; s.has_pending = true; s.current_qty += q; }
  });
  return s;
}

// ── 1. LUX-BK exact production scenario ──
console.log('\n══════ 1: cancelled receipt excluded from Original ══════');
var luxbk = summarize([
  { status: 'received',  quantity: 18381 },   // RCV-2026-06-01-002
  { status: 'cancelled', quantity: 10000 },   // RCV-2026-06-01-001 (america 10001)
]);
ok('Original = 18,381 (not 28,381)', Math.abs(luxbk.original_qty - 18381) < 0.001);
ok('Current  = 18,381 (pending, received-not-finalized)', Math.abs(luxbk.current_qty - 18381) < 0.001);
ok('cancelled 10,000 contributed nothing', luxbk.original_qty !== 28381 && luxbk.pending_qty === 18381);

// ── 2. Largest-first product sort within a family ──
console.log('\n══════ 2: products sorted largest amount first ══════');
var stats = {
  dusty:  { current_qty: 0,     original_qty: 0 },
  black:  { current_qty: 18381, original_qty: 18381 },
  havana: { current_qty: 0,     original_qty: 0 },
  big:    { current_qty: 90000, original_qty: 90000 },
};
var products = [
  { id: 'dusty',  name_en: 'Cotton Dusty' },
  { id: 'black',  name_en: 'Cotton Black' },
  { id: 'havana', name_en: 'Cotton Havana' },
  { id: 'big',    name_en: 'Cotton Big' },
];
products.sort(function (pa, pb) {
  var sa = stats[pa.id] || {}, sb = stats[pb.id] || {};
  var ca = Number(sa.current_qty || 0), cb = Number(sb.current_qty || 0);
  if (cb !== ca) return cb - ca;
  var oa = Number(sa.original_qty || 0), ob = Number(sb.original_qty || 0);
  if (ob !== oa) return ob - oa;
  return String(pa.name_en || '').localeCompare(String(pb.name_en || ''));
});
ok('order is big > black > (zeros by name)', products.map(function (p) { return p.id; }).join(',') === 'big,black,dusty,havana');

// ── 3. Source-contract checks (catch logic drift) ──
console.log('\n══════ 3: source contract ══════');
var srcPath = [
  path.join(__dirname, '..', 'src', 'components', 'InventoryOverview.jsx'),
  '/home/claude/hub/src/components/InventoryOverview.jsx',
].find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
var src = fs.readFileSync(srcPath, 'utf8');
// cancelled guard must appear BEFORE original_qty is summed
var guardIdx = src.indexOf("if (r.status === 'cancelled') return;");
var origIdx = src.indexOf('s.original_qty += q;');
ok('cancelled guard exists and precedes original_qty sum', guardIdx > 0 && origIdx > guardIdx);
ok('product sort comparator present (current desc)', /g\.products\.sort[\s\S]{0,320}return cb - ca/.test(src));

console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails === 0 ? 0 : 1);
