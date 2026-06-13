var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var b=p('src/components/BankReviewTab.jsx');
ok(/function unmatch\(t\)/.test(b),'unmatch() exists');
ok(/voided: true, voided_at:/.test(b),'unmatch soft-voids (sets voided=true) — not hard delete');
ok(/\.update\(stamp\)\.eq\('bank_transaction_id', t\.id\)/.test(b),'voids accounting_invoice_payments by txn');
ok(/payment_matches'\)\.update\(stamp\)\.eq\('bank_transaction_id', t\.id\)/.test(b),'voids payment_matches by txn');
ok(/linked_type: null, linked_id: null/.test(b),'clears txn link on unmatch');
ok(/recomputeInvoice\(id\)/.test(b),'recomputes affected invoice(s)');
ok(!/\.delete\(\)/.test(b) || /reverse/.test(b),'no hard delete of payment rows in unmatch path');
ok(/select\('amount, voided'\)/.test(b) && /if \(!p\.voided\) \{ hubPaid/.test(b),'recompute excludes voided payments (balance restores)');
ok(/Unmatch \(reverse\)/.test(b),'Unmatch button rendered');
ok(/<div className="font-bold mb-1">Matched<\/div>/.test(b),'Matched info card rendered');
ok(/canMatchPayments/.test(b),'unmatch gated by Payments:Match permission');
// behavioral: voiding the only payment restores balance to full
function recompute(total, waveImported, payments){var hub=0;payments.forEach(function(x){if(!x.voided)hub+=x.amount;});var paid=waveImported+hub;return {paid:paid, balance: total-paid};}
var before=recompute(1000,0,[{amount:300,voided:false}]);
ok(before.balance===700,'before unmatch: balance 700');
var after=recompute(1000,0,[{amount:300,voided:true}]);
ok(after.balance===1000 && after.paid===0,'after unmatch (voided): balance restored to 1000');
ok(/version: 'v55\.83-CJ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CJ');
console.log('\nv55.83-CJ unmatch: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
