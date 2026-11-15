var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pi=p('src/app/api/wave/push-invoice/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/business\(id:\$bid\)\{ products\(/.test(pi),'queries existing Wave products');
ok(/name === 'NextTrade Hub Item'/.test(pi),'reuses NextTrade Hub Item product');
ok(/accounts\(page:1,pageSize:50,types:\[INCOME\]\)/.test(pi),'fetches income account for product create');
ok(/productCreate\(input:\$input\)/.test(pi),'creates product when none exists');
ok(/incomeAccountId: incomeAccountId/.test(pi),'product create uses income account');
ok(/productId: productId, description:/.test(pi),'line items now include productId');
ok(/No Wave income account found/.test(pi),'clear failure if no income account');
ok(!/\bconst \b/.test(pi) && !/ => /.test(pi),'SWC-safe');
ok(/version: 'v55\.83-EN'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EN');
console.log('\nv55.83-EN invoice productId: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
