// v55.83-H — Rolls captured at sale + real depletion + visible at product/category level
var fs = require('fs');
var path = require('path');
var fails = 0;
function ok(name, cond) { if (cond) { console.log('\u2713 ' + name); } else { console.log('\u2717 ' + name); fails++; } }
function read(rel) { return fs.readFileSync([path.join(__dirname, '..', rel), '/home/claude/hub/' + rel].find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } }), 'utf8'); }

function rowRolls(s) { var o = s.recv_rolls || 0, sd = s.sold_rolls || 0; return { o: o, sd: sd, c: Math.max(0, o - sd) }; }
console.log('\n== per-row depletion ==');
ok('received 10, sold 3 -> current 7', rowRolls({ recv_rolls: 10, sold_rolls: 3 }).c === 7);
ok('no rolls sold -> current = received', rowRolls({ recv_rolls: 10, sold_rolls: 0 }).c === 10);
ok('over-sold never negative -> 0', rowRolls({ recv_rolls: 10, sold_rolls: 14 }).c === 0);

console.log('\n== summary + family aggregate ==');
var products = [
  { default_uom: 'kg',   _s: { recv_rolls: 10, sold_rolls: 3 } },
  { default_uom: 'kg',   _s: { recv_rolls: 4,  sold_rolls: 4 } },
  { default_uom: 'roll', _s: { recv_rolls: 7,  sold_rolls: 2 } },
];
var t = { o: 0, c: 0, sd: 0 };
products.forEach(function (p) { var u = (p.default_uom || 'unit').toLowerCase().trim(); if (u !== 'roll' && u !== 'rolls') { var o = p._s.recv_rolls, sd = p._s.sold_rolls; t.o += o; t.sd += sd; t.c += Math.max(0, o - sd); } });
ok('original = 14 (roll-unit excluded)', t.o === 14);
ok('sold = 7', t.sd === 7);
ok('current = 7', t.c === 7);

console.log('\n== source contract ==');
var ov = read('src/components/InventoryOverview.jsx');
ok('current rolls = received - sold', /var currRolls = Math\.max\(0, origRolls - soldRolls\);/.test(ov));
ok('sold_rolls aggregated from sales', /s\.sold_rolls \+= Number\(it\.rolls_sold \|\| 0\)/.test(ov));
ok('rolls_sold loaded in select', /inventory_status, rolls_sold/.test(ov));
ok('summary depletes current by sold', /t\.rolls_current \+= Math\.max\(0, oRolls - sRolls\)/.test(ov));
ok('rolls row in Stock Summary (current/original/sold)', /ROLLS<\/span>[\s\S]{0,400}rolls_current[\s\S]{0,300}rolls_original[\s\S]{0,300}rolls_sold/.test(ov));
ok('product table has a Rolls column header', /Rolls<div className="text-\[8px\]/.test(ov));
ok('product row renders dedicated rolls cell', /font-extrabold text-amber-300">\{fmtNum\(currRolls, 0\)\}/.test(ov));
ok('group totals accumulate rolls', /groups\[familyId\]\.totals\.rolls_current \+= Math\.max\(0, gOrig - gSold\)/.test(ov));
ok('category row shows rolls', /ROLLS<\/span>\s*<span className="text-amber-300">\{fmtNum\(g\.totals\.rolls_current/.test(ov));

var pg = read('src/app/page.jsx');
ok('sale line has rolls input', /inv_rolls/.test(pg) && /rolls \/ /.test(pg));
ok('rolls_sold persisted on line', /itemPayload\.rolls_sold = Number\(item\.inv_rolls\)/.test(pg));
var hist = read('src/components/InventoryVariantHistory.jsx');
ok('History shows rolls_sold', /rolls_sold/.test(hist) && /Rolls Sold/.test(hist));

console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails === 0 ? 0 : 1);
