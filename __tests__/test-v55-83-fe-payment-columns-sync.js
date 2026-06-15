var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var lib=p('src/lib/payment-matching.js');var br=p('src/components/BankReviewTab.jsx');
var ai=p('src/components/AccountingInvoicesTab.jsx');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// shared helper
ok(/export function isPaymentVoid/.test(lib),'isPaymentVoid helper exists');
ok(/sync_status[\s\S]{0,80}'void'[\s\S]{0,80}'reversed'/.test(lib),'helper checks void/reversed set');
// all filters use it
ok(/import \{[^}]*isPaymentVoid[^}]*\} from '..\/lib\/payment-matching'/.test(br),'BankReview imports helper');
ok(!/if \(!p\.voided\)/.test(br),'BankReview no longer uses bare !p.voided');
ok(/select\('amount, voided, sync_status'\)/.test(br),'recompute selects sync_status');
ok(/sync_status: 'void'/.test(br),'unmatch sets sync_status void');
ok(/voided: true, sync_status: 'void', voided_at/.test(br),'unmatch sets both flags + voided_at');
ok(/import \{[^}]*isPaymentVoid[^}]*\}/.test(ai),'AccountingInvoicesTab imports helper');
ok(/if \(isPaymentVoid\(p\)\) \{ return; \}/.test(ai),'list map excludes void via helper');
ok(/viewPayments\.forEach\(function \(p\) \{ if \(!isPaymentVoid\(p\)\)/.test(ai),'viewCalc excludes void via helper');
// wave sync center payment queue
ok(/import \{ isPaymentVoid \}/.test(wsc),'WaveSyncCenter imports helper');
ok(/fetchAllRows\('accounting_invoice_payments', '\*', 'payment_date', false\)/.test(wsc),'WaveSyncCenter loads payments');
ok(/action: 'payment'/.test(wsc),'queue has payment action rows');
ok(/p\.sync_status !== 'pending_wave_sync'/.test(wsc),'queue only pending_wave_sync payments');
ok(/if \(p\.wave_payment_id\) \{ return; \}/.test(wsc),'queue excludes already-pushed payments');
ok(/Invoice not yet in Wave/.test(wsc) && /Customer not yet in Wave/.test(wsc),'blocked reasons surfaced');
ok(/q\.action === 'payment'/.test(wsc),'payment count in header breakdown');
ok(/version: 'v55\.83-FE'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FE');
console.log('\nv55.83-FE payment columns + sync: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
