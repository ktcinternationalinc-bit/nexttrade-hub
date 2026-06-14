var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pi=p('src/app/api/wave/push-invoice/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/select\('id, company_name, contact_name, wave_customer_id, wave_business_id'\)/.test(pi),'customer select uses real columns (contact_name, not name)');
ok(!/select\('id, company_name, name, wave_customer_id/.test(pi),'non-existent name column removed');
ok(!/cust\.name/.test(pi),'no cust.name references remain');
ok(/cust\.company_name \|\| cust\.contact_name \|\| cust\.id/.test(pi),'block message uses contact_name');
ok(!/\bconst \b/.test(pi) && !/ => /.test(pi),'SWC-safe');
ok(/version: 'v55\.83-EK'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EK');
console.log('\nv55.83-EK invoice cust select: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
