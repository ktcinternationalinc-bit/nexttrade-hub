var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/function getInvStatus\(row\) \{ return String\(\(row && row\.approval_status\) \|\| 'draft'\)\.trim\(\)\.toLowerCase\(\); \}/.test(r),'normalized status helper');
ok(/canSubmit: isInv && mayEdit && st === 'draft'/.test(r),'invActions.canSubmit');
ok(/canApprove: isInv && \(mayApprove \|\| isSuperAdmin\) && st === 'internal_review'/.test(r),'invActions.canApprove');
ok(/function locked\(row\) \{ return isInvoice\(\) && getInvStatus\(row\) === 'approved'; \}/.test(r),'locked uses normalized status');
ok(/invActions\(row\)\.canSubmit && <button/.test(r),'blotter Submit uses invActions');
ok(/invActions\(editing\)\.canSubmit && <button/.test(r),'edit-screen Submit uses invActions');
ok((r.match(/DBG raw=/g)||[]).length>=2,'debug line on blotter + edit screen');
ok(/version: 'v55\.83-ED'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew ED');
console.log('\nv55.83-ED invoice eligibility: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
