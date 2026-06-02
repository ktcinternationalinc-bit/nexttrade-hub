// ============================================================
// v55.83-H — Inventory command-center slice + finalized QA items
//   A. Overview executive KPI aggregates: inventory_value (Σ finalized layer
//      value) and awaiting_cost (count of products with uncosted stock).
//   B. Navigation grouping: every subtab belongs to a known group; 3 groups.
//   C. Finalize is all-or-nothing: a mid-loop failure rolls back finalized lines.
//   D. "Expected Net KG" relabeled reference-only; submit hint no longer lists it.
// ============================================================

var fs = require('fs');
var path = require('path');
function read(rel) {
  var p = [path.join(__dirname, '..', rel), '/home/claude/hub/' + rel].find(function (x) { try { return fs.existsSync(x); } catch (e) { return false; } });
  return fs.readFileSync(p, 'utf8');
}
var fails = 0;
function ok(name, cond) { if (cond) { console.log('\u2713 ' + name); } else { console.log('\u2717 ' + name); fails++; } }

// ── A. KPI aggregates (mirror of grandTotals loop) ──
console.log('\n══════ A: executive KPI aggregates ══════');
var stats = {
  p1: { current_weighted_cost: 50000, has_pending: false },
  p2: { current_weighted_cost: 0,     has_pending: true  }, // received, not costed
  p3: { current_weighted_cost: 12000, has_pending: true  }, // partly finalized + pending
};
var t = { inventory_value: 0, awaiting_cost: 0 };
Object.keys(stats).forEach(function (id) {
  var s = stats[id];
  t.inventory_value += s.current_weighted_cost || 0;
  if (s.has_pending) t.awaiting_cost += 1;
});
ok('inventory_value sums finalized layer value (62,000)', Math.abs(t.inventory_value - 62000) < 0.01);
ok('awaiting_cost counts products with pending stock (2)', t.awaiting_cost === 2);

var ov = read('src/components/InventoryOverview.jsx');
ok('grandTotals accumulates inventory_value', /t\.inventory_value \+= s\.current_weighted_cost/.test(ov));
ok('grandTotals counts awaiting_cost', /if \(s\.has_pending\) t\.awaiting_cost \+= 1/.test(ov));
ok('financial KPI cards gated behind seeCosts', /if \(seeCosts\) \{[\s\S]{0,120}Inventory Value/.test(ov));
ok('big gradient banner removed (no "What\u0027s in stock right now")', ov.indexOf("What&apos;s in stock right now") === -1);

// ── B. Navigation grouping ──
console.log('\n══════ B: grouped navigation ══════');
var nav = read('src/components/InventoryTab.jsx');
ok('SUBTAB_GROUPS defines 3 groups', /SUBTAB_GROUPS = \[[\s\S]*?core[\s\S]*?import[\s\S]*?financial/.test(nav));
// every subtab line with an id must carry a group
var subtabLines = nav.split('\n').filter(function (l) { return /\{ id: '/.test(l) && /label:/.test(l); });
var allGrouped = subtabLines.every(function (l) { return /group: '(core|import|financial)'/.test(l); });
ok('every subtab has a valid group (' + subtabLines.length + ' tabs)', allGrouped && subtabLines.length >= 13);
ok('nav renders clean name (st.name) not emoji label', /\{st\.name\}/.test(nav));
ok('permission gating preserved (visFor helper)', /function visFor\(st\)/.test(nav) && /Manage Inventory Master/.test(nav));

// ── C. Atomic finalize rollback ──
console.log('\n══════ C: all-or-nothing finalize ══════');
var fin = read('src/components/InventoryFinalizeCostDialog.jsx');
ok('finalized line ids tracked', /finalizedLineIds\.push\(L\.id\)/.test(fin));
ok('rollback reverses via reopen_finalized_receipt on failure', /catch \(lineErr\)[\s\S]{0,400}reopen_finalized_receipt/.test(fin));
ok('clear partial-finalize error surfaced', /rolled back, so the receipt is unchanged/.test(fin));

// ── D. Net KG relabel ──
console.log('\n══════ D: Net KG reference-only ══════');
var rec = read('src/components/InventoryReceiving.jsx');
ok('Net Weight field marked reference only', /Expected Net Weight \(kg\)[\s\S]{0,120}reference only — not reconciled/.test(rec));
ok('submit hint no longer lists net kg as a reconciled total', rec.indexOf('rolls, gross kg, net kg, or UOM') === -1);

console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails === 0 ? 0 : 1);
