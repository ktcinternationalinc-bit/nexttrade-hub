var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/BankReviewTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var siloId = activeBiz \|\| \(inv && inv\.wave_business_id\) \|\| t\.wave_business_id \|\| null/.test(r),'siloId resolved from active/invoice/txn');
ok(/business_id: biz, wave_business_id: siloId, bank_transaction_id: t\.id, invoice_id: inv\.id/.test(r),'main payment_matches stamped');
ok(/payment_matches', \{ business_id: t\.business_id, wave_business_id: \(t\.wave_business_id \|\| getActiveWaveBusiness\(\) \|\| null\)/.test(r),'split payment_matches stamped');
ok(/accounting_invoice_payments', \{[\s\S]{0,80}wave_business_id: \(inv\.wave_business_id \|\| t\.wave_business_id \|\| getActiveWaveBusiness\(\)/.test(r),'invoice-payment row stamped (inherits invoice silo)');
ok(/customer_credits', \{ business_id: biz, wave_business_id: siloId/.test(r),'customer_credits stamped');
ok(/unapplied_deposits', \{ business_id: t\.business_id, wave_business_id: \(t\.wave_business_id \|\| getActiveWaveBusiness\(\)/.test(r),'unapplied_deposits stamped');
// safety regressions
ok(/assertMatchSameSilo/.test(r),'cross-silo block still present');
ok(/sync_status: 'pending_wave_sync'/.test(r) && !/wave_payment_id: '[^']/.test(r),'no fake wave_payment_id; stays pending_wave_sync');
ok(/version: 'v55\.83-DZ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DZ');
console.log('\nv55.83-DZ match silo stamp: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
