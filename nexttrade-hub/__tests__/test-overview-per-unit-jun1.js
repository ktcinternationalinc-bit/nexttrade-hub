var fs=require('fs');
var s=fs.readFileSync('src/components/InventoryOverview.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }
ok('per-unit grandTotals (byUnit)', /var byUnit = \{\}/.test(s) && /t\.units = units/.test(s));
ok('quantities NOT blended (no single current_qty grand total)', !/t\.current_qty \+= g\.totals\.current_qty/.test(s));
ok('money still summed across all', /t\.sold_revenue \+= s\.sold_revenue/.test(s));
ok('per-unit cards rendered', /grandTotals\.units && grandTotals\.units\.length > 0/.test(s));
ok('unit label helper', /function unitLabel/.test(s) && /SQM \(m²\)/.test(s));
ok('toggle removed', !/uomView/.test(s));
ok('selling unit shown under product name', /Sold in: \{p\.default_uom/.test(s));
ok('row current cell shows native qty', /<span>\{fmtNum\(s\.current_qty, 2\)\}<\/span>/.test(s));
ok('status dot retained', /bg-amber-400/.test(s) && /bg-emerald-400/.test(s));
ok('per-unit block shows current/original/sold with unit suffix', /available for sale in/.test(s));
if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — per-unit overview (no blended totals, unit shown per product) ('+10+' checks)');
