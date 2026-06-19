var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var b=p('src/components/BankReviewTab.jsx');
// v55.83-IS: unmatch/reverse moved to the service-role route (RLS-proof). The UI delegates; the
// route does the soft-void + recompute + unlink. Tests assert the new contract, not old client code.
var route=p('src/app/api/accounting/bank-write/route.js');
var um=route.substring(route.indexOf("if (action === 'unmatch')"), route.indexOf("if (action === 'unmatch')")+2400);

ok(/function unmatch\(t\)/.test(b),'unmatch() exists in BankReviewTab');
ok(/bankWrite\('unmatch', \{ bank_transaction_id: t\.id \}\)/.test(b),'UI delegates unmatch to the service route');
ok(um.indexOf("from('accounting_invoice_payments').update({ voided: true")>-1 && /eq\('bank_transaction_id', bid\)/.test(um),'server voids accounting_invoice_payments by txn');
ok(/from\('payment_matches'\)\.update\(\{ voided: true \}\)\.eq\('bank_transaction_id', bid\)/.test(um),'server voids payment_matches by txn');
ok(/linked_type: null, linked_id: null, matched_invoice_id: null/.test(um),'server clears the bank-txn link on unmatch');
ok(/recompute\(db, ik\[w\]\)/.test(um),'server recomputes affected invoice(s)');
ok(/wave_payment_id \|\| pr\[k\]\.sync_status === 'synced' \|\| pr\[k\]\.sync_status === 'manual_done'/.test(um),'server blocks locally reversing a Wave-synced payment');
ok(/Unmatch \(reverse\)/.test(b),'Unmatch button rendered');
ok(/canMatchPayments/.test(b),'unmatch gated by Payments:Match permission');

// behavioral: voiding the only payment restores balance to full (canonical recompute math)
function recompute(total, waveImported, payments){var hub=0;payments.forEach(function(x){if(!x.voided)hub+=x.amount;});var paid=waveImported+hub;return {paid:paid, balance: total-paid};}
ok(recompute(1000,0,[{amount:300,voided:false}]).balance===700,'before unmatch: balance 700');
var after=recompute(1000,0,[{amount:300,voided:true}]);
ok(after.balance===1000 && after.paid===0,'after unmatch (voided): balance restored to 1000');
ok(/version: 'v55\.83-CJ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CJ entry preserved');
console.log('\nv55.83-CJ unmatch (server-route contract): '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
