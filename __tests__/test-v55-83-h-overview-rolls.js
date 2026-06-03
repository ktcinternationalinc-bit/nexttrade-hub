// v55.83-H — Rolls captured at sale + real depletion in Overview
var fs = require('fs');
var path = require('path');
var fails = 0;
function ok(name, cond) { if (cond) { console.log('\u2713 ' + name); } else { console.log('\u2717 ' + name); fails++; } }

function rowRolls(s) {
  var origRolls = s.recv_rolls || 0;
  var soldRolls = s.sold_rolls || 0;
  return { origRolls: origRolls, soldRolls: soldRolls, currRolls: Math.max(0, origRolls - soldRolls) };
}
console.log('\n== per-row depletion ==');
var a = rowRolls({ recv_rolls: 10, sold_rolls: 3 });
ok('received 10, sold 3 -> current 7', a.currRolls === 7 && a.origRolls === 10 && a.soldRolls === 3);
ok('no rolls sold -> current = received', rowRolls({ recv_rolls: 10, sold_rolls: 0 }).currRolls === 10);
ok('over-sold never negative -> 0', rowRolls({ recv_rolls: 10, sold_rolls: 14 }).currRolls === 0);

console.log('\n== summary aggregate ==');
var products = [
  { default_uom: 'kg',   _s: { recv_rolls: 10, sold_rolls: 3 } },
  { default_uom: 'kg',   _s: { recv_rolls: 4,  sold_rolls: 4 } },
  { default_uom: 'roll', _s: { recv_rolls: 7,  sold_rolls: 2 } },
];
var t = { rolls_original: 0, rolls_current: 0, rolls_sold: 0 };
products.forEach(function (p) {
  var u = (p.default_uom || 'unit').toLowerCase().trim();
  if (u !== 'roll' && u !== 'rolls') {
    var o = p._s.recv_rolls || 0, sd = p._s.sold_rolls || 0;
    t.rolls_original += o; t.rolls_sold += sd; t.rolls_current += Math.max(0, o - sd);
  }
});
ok('original = 14 (roll-unit excluded)', t.rolls_original === 14);
ok('sold = 7', t.rolls_sold === 7);
ok('current = 7', t.rolls_current === 7);

console.log('\n== source contract ==');
function read(rel) { return fs.readFileSync([path.join(__dirname, '..', rel), '/home/claude/hub/' + rel].find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } }), 'utf8'); }
var ov = read('src/components/InventoryOverview.jsx');
ok('current rolls = received - sold', /var currRolls = Math\.max\(0, origRolls - soldRolls\);/.test(ov));
ok('sold_rolls aggregated from sales', /s\.sold_rolls \+= Number\(it\.rolls_sold \|\| 0\)/.test(ov));
ok('rolls_sold loaded in select', /inventory_status, rolls_sold/.test(ov));
ok('summary depletes current by sold', /t\.rolls_current \+= Math\.max\(0, oRolls - sRolls\)/.test(ov));
ok('Sold Rolls summary cell present', /Sold Rolls/.test(ov));
var pg = read('src/app/page.jsx');
ok('sale line has rolls input', /inv_rolls/.test(pg) && /rolls \/ /.test(pg));
ok('rolls_sold persisted on line', /itemPayload\.rolls_sold = Number\(item\.inv_rolls\)/.test(pg));
var hist = read('src/components/InventoryVariantHistory.jsx');
ok('History shows rolls_sold', /rolls_sold/.test(hist) && /Rolls Sold/.test(hist));

console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails === 0 ? 0 : 1);
