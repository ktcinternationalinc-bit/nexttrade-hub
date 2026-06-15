var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var ai=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/fetchAllRows\('accounting_invoice_payments', 'accounting_invoice_id, amount, voided, sync_status'\)/.test(ai),'list loads payment rows');
ok(/setHubPaidMap\(paidMap\)/.test(ai),'builds hubPaidMap');
ok(/if \(p\.voided \|\| p\.sync_status === 'void'\) \{ return; \}/.test(ai),'excludes voided payments from map');
ok(/function rowCalc\(row\)/.test(ai),'rowCalc helper exists');
ok(/\{isInvoice\(\) \? fmt\(rc\.paid\) : '\u2014'\}/.test(ai),'list Paid uses rc.paid');
ok(/\{isInvoice\(\) \? fmt\(rc\.balance\) : '\u2014'\}/.test(ai),'list Balance uses rc.balance');
ok(/rc\.paymentStatus/.test(ai),'list shows payment status pill');
ok(/position: 'fixed', inset: 0[\s\S]{0,260}if \(!busy\) setEditing\(null\)/.test(ai),'edit form wrapped in modal overlay');
ok(/maxHeight: 'calc\(100vh - 120px\)', overflowY: 'auto' \}\} onClick=\{function \(e\) \{ e\.stopPropagation/.test(ai),'edit modal container scrolls');
ok(/version: 'v55\.83-FD'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FD');
console.log('\nv55.83-FD list+edit: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
