// SUPERSEDED by v55.83-EU: invoice push no longer creates products (productCreate moved to
// /api/wave/product-setup). ET asserted productCreate-in-push behavior which EU intentionally
// removed. Kept as a marker; assertions now verify the EU supersession instead of green-washing.
var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var v2=p('src/app/api/wave/push-invoice-v2/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(!/productCreate/.test(v2),'SUPERSEDED: productCreate removed from invoice push (now in product-setup route)');
ok(/NO_DEFAULT_PRODUCT_CONFIGURED/.test(v2),'SUPERSEDED: push blocks without configured product instead of creating');
console.log('\nv55.83-ET (SUPERSEDED by EU): '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS (superseded marker)');
