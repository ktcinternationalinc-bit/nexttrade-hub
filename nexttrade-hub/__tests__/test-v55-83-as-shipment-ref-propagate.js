var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
var propagates=(r.match(/from\('inventory_stock_receipts'\)\.update\(\{ shipment_reference: header\.shipment_reference\.trim\(\)/g)||[]).length;
ok(propagates>=2,'reference propagated in BOTH save paths (found '+propagates+')');
ok(/reference propagate failed/.test(r),'propagation is try-wrapped (best-effort)');
ok(/\.eq\('receipt_number', receiptNumber\)/.test(r),'propagation keyed on receipt_number (all lines)');
ok(!/update\(\{ shipment_reference[^}]*supplier/.test(r),'only reference propagated (per-line overrides untouched)');
ok(p('src/app/page.jsx').indexOf('>v55.83-AS<')>=0,'page AS');
ok(/version: 'v55\.83-AS'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AS');
console.log('\nv55.83-AS shipment ref propagate: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
