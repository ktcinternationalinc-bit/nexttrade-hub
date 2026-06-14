var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/\(viewing\.approval_status \|\| 'draft'\) === 'draft' && <button onClick=\{function \(\) \{ var row = viewing; setApproval\(row, 'internal_review'\); setViewing\(null\); \}\}[^>]*>Submit for Review/.test(r),'Submit for Review button inside opened invoice');
ok(/viewing\.approval_status === 'internal_review' && <button onClick=\{function \(\) \{ var row = viewing; setApproval\(row, 'approved'\); setViewing\(null\); \}\}[^>]*>Approve/.test(r),'Approve button inside opened invoice');
ok(/viewing\.approval_status === 'approved' && <button onClick=\{function \(\) \{ var row = viewing; reopenInvoice\(row\); \}\}[^>]*>Reopen/.test(r),'Reopen button inside opened invoice');
// blotter buttons (EA) still present
ok(/\(row\.approval_status \|\| 'draft'\) === 'draft' && <button onClick=\{function \(\) \{ setApproval\(row, 'internal_review'\)/.test(r),'blotter Submit (EA) still present');
ok(/version: 'v55\.83-EB'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EB');
console.log('\nv55.83-EB invoice view approve: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
