var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var ar=p('src/components/AccountingCustomerHistory.jsx');var atab=p('src/components/AccountingTab.jsx');
ok(/total - wave - hub/.test(ar),'balance = total - wave_imported_paid - hub payments (no double-count)');
ok(/isDead/.test(ar)&&/void/.test(ar)&&/cancelled/.test(ar),'void/cancelled excluded from AR');
ok(!/accounting_invoice_payments.*insert|insert.*payment/i.test(ar),'read-only — no payment rows created');
ok(/Total invoiced/.test(ar)&&/Paid \(Wave\)/.test(ar)&&/Paid \(Hub\/Plaid\)/.test(ar)&&/Open balance/.test(ar),'AR summary cards');
ok(/openCount/.test(ar)&&/paidCount/.test(ar)&&/partialCount/.test(ar)&&/overdueCount/.test(ar),'invoice counts');
ok(/Payment history/.test(ar)&&/bank_transactions/.test(ar),'payment history joins bank txns');
ok(/Proformas/.test(ar)&&/converted_invoice_id/.test(ar),'proformas section');
ok(/Deductions not yet enabled/.test(ar),'deductions placeholder');
ok(/needs_review/.test(ar)&&/'review'/.test(ar)&&/'open'/.test(ar),'filters all|review|open + placeholder flag');
ok(/canViewBank/.test(ar)&&/canSeeAmounts/.test(ar),'permission-gated + amount masking');
ok(/'arhistory', '📒 Customer AR History'/.test(atab)&&/<AccountingCustomerHistory /.test(atab),'wired as Accounting sub-tab');
ok(p('src/app/page.jsx').indexOf('>v55.83-AU<')>=0,'page AU');
ok(/version: 'v55\.83-AU'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AU');
console.log('\nv55.83-AU AR history: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
