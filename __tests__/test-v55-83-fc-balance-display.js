var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var ai=p('src/components/AccountingInvoicesTab.jsx');var br=p('src/components/BankReviewTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var paid = roundMoney\(waveImported \+ hubPaid\)/.test(ai),'viewCalc derives paid from payment rows');
ok(/var balance = roundMoney\(Math\.max\(0, docTot - paid\)\)/.test(ai),'viewCalc balance from paid (not stale)');
ok(!/viewing && viewing\.balance_due != null\) \? Number\(viewing\.balance_due\)/.test(ai),'stale balance_due preference removed');
ok(/var paymentStatus = paid <= 0\.0001/.test(ai),'viewCalc computes payment status');
ok(/isInvoice\(\) \? ' \xb7 ' \+ vc\.paymentStatus/.test(ai),'modal status uses vc.paymentStatus');
ok(/!p\.voided && p\.sync_status !== 'void'/.test(ai),'excludes voided + void payments');
ok(/padding: '88px 16px 32px'/.test(ai),'modal overlay padding leaves top room');
ok(/maxHeight: 'calc\(100vh - 120px\)'/.test(ai),'modal container max height + scroll');
ok(/select\('amount, voided, sync_status'\)\.eq\('accounting_invoice_id', inv\.id\)/.test(br),'applyToInvoice reads live paid before classify');
ok(!/var paidNow = Number\(inv\.amount_paid\) \|\| 0;/.test(br),'stale inv.amount_paid classify removed');
ok(!/applyToInvoice_OLD_DEAD/.test(br),'dead duplicate function removed');
ok(/version: 'v55\.83-FC'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FC');
console.log('\nv55.83-FC balance display: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
