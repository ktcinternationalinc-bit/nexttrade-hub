var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var ps=p('src/app/api/wave/product-setup/route.js');var v2=p('src/app/api/wave/push-invoice-v2/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/bid === 'REAL_KTC_WAVE_BUSINESS_ID' \|\| bid === 'TEST_WAVE_BUSINESS_ID'/.test(ps),'rejects placeholder business ids');
ok(/node\.id === body\.product_id/.test(ps),'select verifies product belongs to business');
ok(/match\.isArchived === true/.test(ps),'select rejects archived product');
ok(/'manual_selected'/.test(ps) && /'found_exact_name'/.test(ps),'sources labeled per spec');
ok(/name === 'NextTrade Hub Item'/.test(ps),'find requires exact name');
ok(/default_invoice_product_name: pname, source: source/.test(ps),'saved row includes source + name');
ok(!/productCreate/.test(v2),'invoice push still no productCreate');
ok(/NO_DEFAULT_PRODUCT_CONFIGURED/.test(v2),'invoice push blocks without configured product');
ok(/version: 'v55\.83-EV'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EV');
console.log('\nv55.83-EV security: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
