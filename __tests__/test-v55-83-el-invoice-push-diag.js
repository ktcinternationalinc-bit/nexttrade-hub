var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pi=p('src/app/api/wave/push-invoice/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var custLinkId = inv\.accounting_customer_id \|\| null;/.test(pi),'captures the FK explicitly');
ok(/if \(!custLinkId\)/.test(pi) && /no_customer_link/.test(pi),'distinct no-customer-link branch');
ok(/\.select\('id, company_name, contact_name, wave_customer_id, wave_business_id'\)\.eq\('id', custLinkId\)/.test(pi),'plain select (no single) on real columns');
ok(!/\.single\(\)/.test(pi.split('accounting_customers')[1] || ''),'no .single() on customer lookup');
ok(/custRes\.error/.test(pi) && /customer_query_error/.test(pi),'captures + reports db error');
ok(/customer_row_missing/.test(pi),'distinct missing-row branch');
ok(/customer_no_wave_id/.test(pi),'distinct no-wave-id branch');
ok(/reason:/.test(pi),'logs a reason code in payload');
ok(!/\bconst \b/.test(pi) && !/ => /.test(pi),'SWC-safe');
ok(/version: 'v55\.83-EL'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EL');
console.log('\nv55.83-EL invoice push diag: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
