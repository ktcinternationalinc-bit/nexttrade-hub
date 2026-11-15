var fs=require('fs');
var rc=fs.readFileSync('src/components/InventoryReceiving.jsx','utf8');
var ov=fs.readFileSync('src/components/InventoryOverview.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }

// (a) conscious origin dropdown
ok('origin dropdown no longer silent-defaults to US', !/header\.origin_country_code \|\| 'US'\}/.test(rc));
ok('origin has Select prompt', /— Select country —/.test(rc));
ok('origin includes Canada + Egypt', /value="CA"/.test(rc) && /value="EG"/.test(rc));
ok('origin stamped on receipt line', /origin_country_code: header\.origin_country_code \|\| null,\s*\n\s*variance_reason/.test(rc));

// Order Qty removed + grid now 3 cols
ok('Order Qty field removed', !/>Order Qty\s*\n/.test(rc) && !/'ordered_quantity', e\.target\.value/.test(rc));
ok('row1 grid now 3 columns', /grid grid-cols-3 gap-2 mb-2/.test(rc));
ok('per-line variance banner removed', !/⚠ Variance: ordered \{ord\} vs received/.test(rc));

// (b) intake-by-country report
ok('intake state added', /historyIntakeByCountry/.test(ov));
ok('queries receipts by product for country split', /inventory_stock_receipts'\)\s*\n?\s*\.select\('quantity, quantity_kg, roll_count, origin_country_code/.test(ov));
ok('groups by country, skips cancelled', /r\.status === 'cancelled'/.test(ov));
ok('renders Intake by Country panel', /Intake by Country/.test(ov));
ok('country labels map US/Canada', /USCA: 'US\/Canada'/.test(ov));

if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — receiving origin dropdown + Order Qty removed + intake-by-country report ('+12+' checks)');
