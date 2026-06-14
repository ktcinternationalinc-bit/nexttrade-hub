var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pc=p('src/app/api/wave/push-customer/route.js');var pi=p('src/app/api/wave/push-invoice/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var displayName = cust\.company_name \|\| cust\.contact_name \|\| cust\.name/.test(pc),'displayName mapping');
ok(/cust\.contact_name.*\.split\(\/\\s\+\/\)/.test(pc),'contact_name split into first/last');
ok(/if \(firstName\) \{ input\.firstName = firstName; \}/.test(pc),'firstName only when present');
ok(/if \(lastName\) \{ input\.lastName = lastName; \}/.test(pc),'lastName only when present');
ok(/if \(cust\.email\) \{ input\.email = cust\.email; \}/.test(pc),'email only when present (no blank overwrite)');
ok(/customer\{ id name firstName lastName email \}/.test(pc),'mutation returns first/last for verification');
ok(/would_create: \{ name: pvName, contact: pvContact, email/.test(pc),'dry-run previews name+contact+email');
ok(/request_payload: reqPayload/.test(pc),'real push logs request_payload');
ok(/Push this customer first: "' \+ cn \+ '" \(Hub id ' \+ cid/.test(pi),'invoice block names the customer');
ok(/needs_customer: \{ name: cn, hub_id: cid \}/.test(pi),'invoice block returns needs_customer');
ok(/cust\.wave_business_id !== waveBusinessId/.test(pi),'invoice cross-silo customer check');
ok(!/\bconst \b/.test(pc) && !/ => /.test(pc) && !/\bconst \b/.test(pi) && !/ => /.test(pi),'SWC-safe');
ok(/version: 'v55\.83-EG'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EG');
console.log('\nv55.83-EG customer mapping: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
