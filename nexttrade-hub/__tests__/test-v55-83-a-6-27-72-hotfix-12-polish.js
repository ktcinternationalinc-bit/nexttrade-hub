/* v72 HOTFIX 12 polish — finishing the two items Max called out:
 *   1. AR rows blue / AP rows orange — applied to description text, AR/AP cells,
 *      column header backgrounds, Open Balance color, Summary block, bottom cards,
 *      print export, and Excel export hex colors.
 *   2. Edit button contrast fixed — amber-400 with dark slate-900 text and a ring
 *      makes it stand out from the row of dark-bg buttons.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');
var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');
var pm = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryProductMaster.jsx'), 'utf8');

console.log('\n── TRANSACTION_TYPES metadata adds descCls + amountCls ──');

ok('A1: sales_invoice has blue descCls + amountCls',
  /sales_invoice:[\s\S]{0,500}descCls: 'text-blue-900'[\s\S]{0,100}amountCls: 'text-blue-800'/.test(ledger));

ok('A2: payment_received has blue descCls + amountCls (AR-affecting)',
  /payment_received:[\s\S]{0,500}descCls: 'text-blue-900'[\s\S]{0,100}amountCls: 'text-blue-800'/.test(ledger));

ok('A3: vendor_bill has orange descCls + amountCls',
  /vendor_bill:[\s\S]{0,500}descCls: 'text-orange-900'[\s\S]{0,100}amountCls: 'text-orange-800'/.test(ledger));

ok('A4: payment_sent has orange descCls + amountCls (AP-affecting)',
  /payment_sent:[\s\S]{0,500}descCls: 'text-orange-900'[\s\S]{0,100}amountCls: 'text-orange-800'/.test(ledger));

console.log('\n── Screen ledger uses the metadata ──');

ok('B1: Description cell uses typeMeta.descCls (auto-colors per AR/AP)',
  /typeMeta\.descCls/.test(oa));

ok('B2: AR Side column header has blue bg (was emerald)',
  /bg-blue-50[\s\S]{0,300}AR Side/.test(oa));

ok('B3: AP Side column header has orange bg (was red)',
  /bg-orange-50[\s\S]{0,300}AP Side/.test(oa));

ok('B4: AR cells render in blue (text-blue-800)',
  /text-blue-800 bg-blue-50\/40/.test(oa));

ok('B5: AP cells render in orange (text-orange-800)',
  /text-orange-800 bg-orange-50\/40/.test(oa));

ok('B6: Open Balance colored blue (AR) / orange (AP)',
  /txnType === 'sales_invoice' \? 'text-blue-900' : 'text-orange-900'/.test(oa));

console.log('\n── Summary block + bottom cards use blue/orange ──');

ok('C1: Total AR row has blue accent in Summary',
  /bg-blue-900\/40 text-blue-100/.test(oa));

ok('C2: Total AP row has orange accent in Summary',
  /bg-orange-900\/40 text-orange-100/.test(oa));

ok('C3: Net Position sub-label cls is blue (positive) or orange (negative)',
  /net > 0\.005 \? 'text-blue-300' : net < -0\.005 \? 'text-orange-300'/.test(oa));

ok('C4: Bottom grand-total Open AR card uses bg-blue-700',
  /bg-blue-700 text-white rounded[\s\S]{0,300}Total Open AR/.test(oa));

ok('C5: Bottom grand-total Open AP card uses bg-orange-700',
  /bg-orange-700 text-white rounded[\s\S]{0,300}Total Open AP/.test(oa));

ok('C6: Bottom Net Balance card uses blue (positive) or orange (negative)',
  /t\.balance >= 0 \? 'bg-blue-800' : 'bg-orange-800'/.test(oa));

console.log('\n── Print + Excel exports use blue/orange hex ──');

ok('D1: Print export AR Side cells use #1d4ed8 (blue-700)',
  /color:#1d4ed8/.test(exp));

ok('D2: Print export AP Side cells use #c2410c (orange-700)',
  /color:#c2410c/.test(exp));

ok('D3: Print export NO emerald-700 (#15803d) anywhere',
  !/#15803d/.test(exp));

ok('D4: Print export NO red-700 (#b91c1c) anywhere',
  !/#b91c1c/.test(exp));

ok('D5: Print export AR Side bg uses #eff6ff (blue-50)',
  /background:#eff6ff/.test(exp));

ok('D6: Print export AP Side bg uses #fff7ed (orange-50)',
  /background:#fff7ed/.test(exp));

console.log('\n── Edit button contrast (Inventory Product Master) ──');

ok('E1: Edit button uses bg-amber-400 (bright, stands out from other dark buttons)',
  /bg-amber-400 hover:bg-amber-500 text-slate-900/.test(pm));

ok('E2: Edit button has ring for extra visibility',
  /ring-1 ring-amber-700/.test(pm));

ok('E3: Edit button size bumped from text-[10px] to text-[11px]',
  /Edit[\s\S]{0,200}text-\[11px\]|text-\[11px\][\s\S]{0,300}Edit/.test(pm));

ok('E4: Edit button has pencil emoji for instant recognition',
  /✏️ Edit/.test(pm));

ok('E5: Copy + Delete + Reactivate also bumped to text-[11px] for consistency',
  (pm.match(/text-\[11px\] bg-(?:blue|red|amber|emerald|purple)-\d+/g) || []).length >= 4);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 12 polish — AR=blue, AP=orange, Edit button readable');
console.log('══════════════════════════════════════════════');
