var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function load(f){return p(f).replace(/export \{[\s\S]*?\};\s*$/,'').replace(/^import[^\n]*\n/gm,'');}
var m={exports:{}};(new Function('module','exports', load('src/lib/wave-silo-guard.js')+load('src/lib/wave-sync-eligibility.js')+'\nmodule.exports={dryRunRecord,paymentEligible,invoiceEligible,customerEligible};'))(m,m.exports);
var E=m.exports;
var cust=p('src/app/api/wave/push-customer/route.js');var invr=p('src/app/api/wave/push-invoice/route.js');var payr=p('src/app/api/wave/push-payment/route.js');
var ui=p('src/components/WaveSyncCenter.jsx');var at=p('src/components/AccountingTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var reg=[{wave_business_id:'A',label:'Test',is_production:false,writes_enabled:true,allow_customer_push:true,allow_invoice_push:true},
         {wave_business_id:'B',label:'Real KTC',is_production:true,writes_enabled:false}];
// eligibility/dry run
ok(E.dryRunRecord({action:'customer',record:{company_name:'X',source:'hub',wave_business_id:'A'},waveBusinessId:'A',registry:reg}).verdict==='dry_run_ok','dry run ok test customer');
ok(E.dryRunRecord({action:'invoice',record:{invoice_number:'I1',total_amount:9,approval_status:'approved',source:'hub',wave_business_id:'B'},waveBusinessId:'B',registry:reg}).verdict==='dry_run_failed','production invoice dry run failed');
ok(E.paymentEligible({amount:5,payment_date:'x',sync_status:'pending_wave_sync',source:'plaid_match'},{wave_invoice_id:'i'},{wave_customer_id:'c'}).unsupported===true,'payment unsupported');
// routes enforce guard + log + production block
ok(/allow_customer_push !== true/.test(cust) && /writes_enabled !== true/.test(cust),'customer route enforces writes+allow flags');
ok(/wave_customer_id\) \{ return \{ ok: false, message: 'Customer already exists in Wave/.test(cust),'customer route never recreates existing Wave customer');
ok(/customerCreate/.test(cust) && /read_back/.test(cust),'customer route pushes + reads back');
ok(/is_production !== false\) \{ return \{ ok: false, message: 'Production writes are disabled/.test(invr),'invoice route blocks production');
ok(/customer is not in Wave yet|customer is not in Wave|not in Wave yet/.test(invr),'invoice route requires customer in Wave first');
ok(/invoiceCreate/.test(invr) && /read_back/.test(invr),'invoice route pushes + reads back');
ok(/unsupported: true/.test(payr) && /does not support creating payments/.test(payr),'payment route returns unsupported, no fake');
ok(/wave_sync_log/.test(cust) && /wave_sync_log/.test(invr) && /wave_sync_log/.test(payr),'all routes write sync log');
// SWC safety (route bodies)
ok(!/\bconst \b/.test(cust) && !/ => /.test(cust),'customer route SWC-safe');
ok(!/\bconst \b/.test(invr) && !/ => /.test(invr),'invoice route SWC-safe');
// UI
ok(/Dry Run Selected/.test(ui) && /Push Selected/.test(ui),'Sync Center has Dry Run + Push');
ok(/Production writes are disabled in this build/.test(ui),'Sync Center shows production read-only');
ok(/allow_payment_push.*Wave does not support|payment push \(Wave does not support/.test(ui),'payment flag locked off in settings');
ok(/<SiloBanner/.test(ui),'Sync Center shows silo banner');
ok(/\['wavesync', '\\ud83d\\udd04 Wave Sync Center'\]|wavesync.*Wave Sync Center/.test(at) && /<WaveSyncCenter/.test(at),'Sync Center wired into AccountingTab');
ok(/version: 'v55\.83-DL'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DL');
console.log('\nv55.83-DL wave sync: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
