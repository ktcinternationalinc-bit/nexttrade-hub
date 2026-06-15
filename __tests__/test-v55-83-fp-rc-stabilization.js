var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pp=p('src/app/api/wave/push-payment/route.js');var pa=p('src/app/api/wave/payment-account-setup/route.js');var ps=p('src/app/api/wave/product-setup/route.js');var sc=p('src/app/api/wave/sync-categories/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');var ait=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// P0 #1 server-side auth on all write routes
ok(/assertPermission\(db, by, 'wave.payments.push'/.test(pp),'push-payment checks wave.payments.push');
ok(/assertPermission\(db, body\.user_id, 'wave.settings.manage'/.test(pa),'payment-account-setup checks wave.settings.manage');
ok(/assertPermission\(db, body\.user_id, 'wave.settings.manage'/.test(ps),'product-setup checks wave.settings.manage');
// P0 #2 payment account capable-only (already FO) + server reject
ok(/not a bank\/cash account and cannot receive payments/.test(pa),'API rejects non-capable account');
ok(/capable\s*\?\s*<button onClick=\{function \(\) \{ runPaymentAccountSetup\('select'/.test(wsc),'UI Use this only on capable');
// P1 #4 categories auth table
ok(/assertPermission\(db, \(bodyJson && bodyJson\.user_id\)[\s\S]*?'wave\.categories\.pull'/.test(sc),'categories checks wave.categories.pull');
// P1 #5 payment_matches column
ok(/from\('payment_matches'\)\.select\('invoice_id, voided'\)/.test(ait),'invoice tab reads payment_matches.invoice_id');
ok(/row\.invoice_id && row\.voided !== true/.test(ait),'match map keyed on invoice_id, skips voided');
// P1 #6 invoice save recompute
ok(/var realPaid = \(editing && editing !== 'new'\) \? \(Number\(hubPaidMap\[editing\]\)/.test(ait),'invoice save recomputes paid from payments');
ok(/balance_due: newBalance, payment_status: newStatus/.test(ait),'save writes recomputed balance + status');
// P1 #7 one-at-a-time payments
ok(/selectedPayments\.length > 1/.test(wsc) && /ONE at a time/.test(wsc),'payments forced one at a time');
// P1 #8 mark manual done hardened
ok(/if \(!isSuperAdmin\) \{ toast\.error\('Only a super admin can mark/.test(wsc),'manual done super_admin only');
ok(/window\.prompt\('Enter the Wave reference/.test(wsc),'manual done requires reference');
ok(/action: 'manual_done'/.test(wsc),'manual done audited to sync log');
// preflight
ok(/Payment push readiness/.test(wsc),'preflight readiness panel present');
console.log('\nv55.83-FP RC stabilization: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
