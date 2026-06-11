// v55.83-Q — expected-totals reload + Kg/net-billable UOM defaults.
const fs = require('fs');
const p = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const rc = p('src/components/InventoryReceiving.jsx');

// UOM defaults to kg, not meter
ok(/expected_uom_type: 'kg'/.test(rc), 'initial/new state defaults UOM to kg');
ok(!/expected_uom_type: 'meter'/.test(rc), 'no meter default left in state');
ok(/header\.expected_uom_type \|\| 'kg'/.test(rc), 'UOM select falls back to kg');
ok(!/header\.expected_uom_type \|\| 'meter'/.test(rc), 'no meter fallback left in select');

// NEXPAC import sets kg + net billable, editable
ok(/patch\.expected_uom_type = 'kg'/.test(rc), 'NEXPAC import defaults UOM type to kg');
ok(/if \(netKg\) patch\.expected_total_uom = Number\(netKg\)\.toFixed\(3\)/.test(rc), 'NEXPAC import fills UOM total with net billable');

// expected totals reload on BOTH edit paths
ok(/expected_total_rolls: h\.expected_total_rolls != null \? String\(h\.expected_total_rolls\)/.test(rc), 'header-only edit reloads expected totals from header');
ok(/select\('expected_total_rolls, expected_total_gross_kg, expected_total_net_kg, expected_total_uom, expected_uom_type, nexpac_breakdown'\)/.test(rc), 'normal edit fetches expected totals from header');
ok(/expected_total_rolls: hRow\.expected_total_rolls != null \? String\(hRow\.expected_total_rolls\)/.test(rc), 'normal edit merges expected totals into form');
ok(/expected_uom_type: hRow\.expected_uom_type \|\| 'kg'/.test(rc), 'normal edit reloads UOM type (kg default)');

// version
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')), 'page.jsx has a v55.83 build stamp');
ok(/version: 'v55\.83-Q'/.test(p('src/components/WhatsNewWidget.jsx')), 'WhatsNew top entry v55.83-Q');

console.log('\nv55.83-Q expected-totals + UOM: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
