var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/invActions\(editing\)\.canSubmit && <button onClick=\{function \(\) \{ var row = editing; setApproval\(row, 'internal_review'\)/.test(r),'Edit screen has Submit for Review (invActions)');
ok(/invActions\(editing\)\.canApprove && <button onClick=\{function \(\) \{ var row = editing; setApproval\(row, 'approved'\)/.test(r),'Edit screen has Approve (invActions)');
// other surfaces retained
ok(/var row = viewing; setApproval\(row, 'internal_review'\); setViewing\(null\)/.test(r),'View-modal Submit (EB) retained');
ok(/invActions\(row\)\.canSubmit && <button onClick=\{function \(\) \{ setApproval\(row, 'internal_review'\)/.test(r),'blotter Submit retained (invActions)');
ok(/version: 'v55\.83-EC'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EC');
console.log('\nv55.83-EC edit approve: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
