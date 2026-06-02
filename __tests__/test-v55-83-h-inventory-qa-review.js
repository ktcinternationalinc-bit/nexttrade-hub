// ============================================================
// v55.83-H QA review — Inventory Overview totals
// Findings vetted in the Jun 2 2026 deep code review:
//   F1. pending_detail lines (logged but not physically received — quantity
//       holds the supplier's EXPECTED number or a 0.001 placeholder) must NOT
//       count as on-hand stock or as Original received.
//   F2. Average cost must divide cost-of-layers by the FINALIZED quantity, not
//       current_qty (current_qty also includes uncosted pending stock, which
//       diluted the average downward).
//   F3. Unit aliases (roll/rolls, meter/meters, m2/sqm...) must collapse to one
//       bucket so the per-unit summary doesn't split a unit into two blocks.
//
// Mirrors the exact Overview algorithms; also asserts the source contract.
// ============================================================

var fs = require('fs');
var path = require('path');

var fails = 0;
function ok(name, cond) { if (cond) { console.log('\u2713 ' + name); } else { console.log('\u2717 ' + name); fails++; } }

// ── Mirror of the receipts summation (cancelled + pending_detail excluded) ──
function rollupReceipts(receipts) {
  var s = { original_qty: 0, current_qty: 0, pending_qty: 0, finalized_qty: 0, current_weighted_cost: 0 };
  receipts.forEach(function (r) {
    if (r.status === 'cancelled' || r.status === 'pending_detail') return;
    var q = Number(r.quantity || 0);
    s.original_qty += q;
    if (r.status === 'finalized') { /* current/cost come from layers */ }
    else { s.pending_qty += q; s.current_qty += q; }
  });
  return s;
}
function addLayers(s, layers) {
  layers.forEach(function (l) {
    var q = Number(l.qty_remaining || 0);
    s.current_qty += q; s.finalized_qty += q;
    s.current_weighted_cost += q * Number(l.cost_per_uom || 0);
  });
  return s;
}

// ── F1: pending_detail excluded ──
console.log('\n══════ F1: pending_detail not counted as stock ══════');
var f1 = rollupReceipts([
  { status: 'received',       quantity: 18381 },
  { status: 'pending_detail', quantity: 9999 },   // supplier's expected, not arrived
  { status: 'pending_detail', quantity: 0.001 },  // placeholder row
  { status: 'cancelled',      quantity: 10000 },
]);
ok('Original = 18,381 (pending_detail + cancelled excluded)', Math.abs(f1.original_qty - 18381) < 0.0001);
ok('Current  = 18,381 (no phantom incoming stock)', Math.abs(f1.current_qty - 18381) < 0.0001);

// ── F2: avg cost over finalized qty, not current ──
console.log('\n══════ F2: avg cost not diluted by pending ══════');
var s2 = rollupReceipts([
  { status: 'finalized', quantity: 10000 }, // current/cost from layer below
  { status: 'received',  quantity: 8381 },  // pending, uncosted
]);
addLayers(s2, [{ qty_remaining: 10000, cost_per_uom: 5.00 }]); // finalized 10k @ 5.00
var avgCostFixed = s2.finalized_qty > 0 ? s2.current_weighted_cost / s2.finalized_qty : 0;
var avgCostOld   = s2.current_qty   > 0 ? s2.current_weighted_cost / s2.current_qty   : 0;
ok('avg cost = 5.00 (over finalized qty)', Math.abs(avgCostFixed - 5.00) < 0.0001);
ok('old method understated it (~2.72)', avgCostOld < 3 && avgCostOld > 2.5);

// ── F3: unit alias normalization ──
console.log('\n══════ F3: unit aliases collapse to one bucket ══════');
function bucketKey(u) {
  var raw = (u || 'unit').toLowerCase().trim();
  var aliases = { rolls: 'roll', meters: 'meter', metre: 'meter', metres: 'meter',
                  yards: 'yard', pieces: 'piece', pcs: 'piece', pc: 'piece',
                  units: 'unit', m2: 'sqm', 'sq_m': 'sqm', sqmeter: 'sqm', sqmeters: 'sqm', kgs: 'kg' };
  return aliases[raw] || raw;
}
ok('roll == rolls', bucketKey('roll') === bucketKey('rolls'));
ok('meter == meters', bucketKey('meter') === bucketKey('meters'));
ok('m2 == sqm', bucketKey('m2') === bucketKey('sqm'));
ok('kg == kgs', bucketKey('kg') === bucketKey('kgs'));

// ── Source contract ──
console.log('\n══════ source contract ══════');
var srcPath = [
  path.join(__dirname, '..', 'src', 'components', 'InventoryOverview.jsx'),
  '/home/claude/hub/src/components/InventoryOverview.jsx',
].find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
var src = fs.readFileSync(srcPath, 'utf8');
ok('pending_detail excluded in receipts loop', /r\.status === 'cancelled' \|\| r\.status === 'pending_detail'\) return;/.test(src));
ok('avg cost uses finalized_qty', /s\.finalized_qty > 0 \? s\.current_weighted_cost \/ s\.finalized_qty/.test(src));
ok('unit alias map present', /aliases = \{ rolls: 'roll'/.test(src));

console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails === 0 ? 0 : 1);
