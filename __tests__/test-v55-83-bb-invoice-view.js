var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var t=p('src/components/AccountingInvoicesTab.jsx');
ok(/function openView\(row\)/.test(t),'openView function exists');
ok(/onClick=\{function \(\) \{ openView\(row\); \}\}/.test(t),'View button / row click opens view');
ok((t.match(/openView\(row\)/g)||[]).length>=2,'row click + View button both call openView');
ok(/accounting_invoice_payments'\)\.select\('\*'\)\.eq\('accounting_invoice_id'/.test(t),'view loads payment rows');
ok(/function viewCalc\(\)/.test(t)&&/docTot - waveImported - hubPaid/.test(t),'view balance = total - wave imported - hub payments');
ok(/Wave import/.test(t)&&/Hub-created/.test(t),'shows source Wave import vs Hub-created');
ok(/Wave imported paid/.test(t)&&/Hub \/ Plaid matched paid/.test(t)&&/Balance due/.test(t),'shows wave paid + hub paid + balance');
ok(/Discount \/ adjustment/.test(t)&&/Subtotal/.test(t),'view shows subtotal + discount when applicable');
ok(/read-only/.test(t),'view labelled read-only');
ok(/editable && mayEdit && <button onClick=\{function \(\) \{ var row = viewing; setViewing\(null\); startEdit\(row\)/.test(t),'Edit only when editable (Reopen path unchanged)');
ok(!/setApproval\(viewing/.test(t)&&!/reopenInvoice\(viewing/.test(t),'View never mutates status');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page has version stamp');
ok(/version: 'v55\.83-BB'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BB');
console.log('\nv55.83-BB invoice view: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
