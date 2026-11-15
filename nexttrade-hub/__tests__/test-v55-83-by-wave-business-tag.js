var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var inv=p('src/app/api/wave/import-invoices/route.js');
var cust=p('src/app/api/wave/import-customers/route.js');
ok((inv.match(/wave_business_id: businessId/g)||[]).length>=2,'invoices route stamps wave_business_id (invoice + placeholder customer)');
ok((cust.match(/wave_business_id: businessId/g)||[]).length>=2,'customers route stamps wave_business_id (insert + update)');
// stamped inside the shared fields obj so BOTH insert and update carry it
ok(/business_id: internalBusinessId,\n            wave_business_id: businessId,/.test(inv),'invoice fields carry tag (insert+update share fields)');
ok(/business_id: internalBusinessId,\n          wave_business_id: businessId/.test(cust),'customer insert fields carry tag');
ok(/wave_sync_status: 'synced', wave_business_id: businessId/.test(cust),'customer UPDATE path also tags');
// SWC safe in code
function codeOnly(s){return s.split('\n').filter(function(l){return l.trim().indexOf('//')!==0;}).join('\n');}
ok(!/`/.test(codeOnly(inv))&&!/=>/.test(codeOnly(inv)),'invoices route SWC-safe');
ok(!/`/.test(codeOnly(cust))&&!/=>/.test(codeOnly(cust)),'customers route SWC-safe');
ok(/version: 'v55\.83-BY'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BY');
console.log('\nv55.83-BY wave business tag: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
