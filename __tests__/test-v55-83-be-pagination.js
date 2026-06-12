var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var help=p('src/lib/fetch-all-rows.js');var dash=p('src/components/AccountingDashboard.jsx');var inv=p('src/components/AccountingInvoicesTab.jsx');var hist=p('src/components/AccountingCustomerHistory.jsx');var bank=p('src/components/BankReviewTab.jsx');
ok(/export function fetchAllRows/.test(help)&&/\.range\(from, from \+ 999\)/.test(help)&&/res\.data\.length < 1000/.test(help),'paginator loops .range until <1000');
ok(/fetchAllRows\('accounting_invoices'/.test(dash)&&/fetchAllRows\('accounting_invoice_payments'/.test(dash),'dashboard reads paginated');
ok(/fetchAllRows\('accounting_invoices', '\*', 'created_at', false\)/.test(inv),'invoice list paginated');
ok(/fetchAllRows\('accounting_invoices', '\*'\)/.test(hist)&&/fetchAllRows\('bank_transactions'/.test(hist),'AR history paginated');
ok(/fetchAllRows\('accounting_invoices', '\*', 'created_at', false\)/.test(bank),'bank matching invoice list paginated');
ok(!/from\('accounting_invoices'\)\.select\('\*'\)\.order\('created_at'/.test(inv),'no capped invoice select remains in list');
ok(/AR data audit/.test(dash)&&/Invoices loaded/.test(dash)&&/withWaveId/.test(dash),'dashboard diagnostic audit panel');
ok(/By year:/.test(dash)&&/By Wave sync:/.test(dash)&&/AR included:/.test(dash),'audit shows by-year, sync, AR inclusion');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page version stamp');
ok(/version: 'v55\.83-BE'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BE');
console.log('\nv55.83-BE pagination + audit: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
