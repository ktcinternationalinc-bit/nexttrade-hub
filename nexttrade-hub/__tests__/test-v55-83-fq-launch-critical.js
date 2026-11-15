var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var imp=p('src/app/api/wave/import-invoices/route.js');var arh=p('src/components/AccountingCustomerHistory.jsx');var dash=p('src/components/AccountingDashboard.jsx');var ait=p('src/components/AccountingInvoicesTab.jsx');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// #5 paid/balance void-aware on ALL surfaces
ok(/isPaymentVoid/.test(ait),'invoice blotter void-aware');
ok(/import.*isPaymentVoid|isPaymentVoid.*payment-matching/.test(arh) && /!isPaymentVoid\(p\)/.test(arh),'AR history skips voided payments');
ok(/isPaymentVoid\(p\)\) return/.test(dash),'dashboard uses canonical void check');
// #6 double-count guard
ok(/DOUBLE-COUNT GUARD/.test(imp),'import has double-count guard');
ok(/hubPushedByInv/.test(imp) && /not\('wave_payment_id', 'is', null\)/.test(imp),'sums Hub-pushed payments by wave_payment_id');
ok(/var waveImportedPaid = r2\(paid - hubPushed\)/.test(imp),'wave_imported_paid excludes Hub-pushed portion');
ok(/wave_imported_paid: waveImportedPaid/.test(imp),'writes adjusted wave_imported_paid');
ok(/amount_paid: paid/.test(imp),'amount_paid stays full paid (no under-count)');
// #8 failed visible
ok(/'sync_failed': 1, 'failed': 1/.test(wsc),'failed statuses in actionable queue');
ok(/p\.sync_error \|\| 'Previous push failed'/.test(wsc),'failed rows show exact error');
console.log('\nv55.83-FQ launch critical: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
