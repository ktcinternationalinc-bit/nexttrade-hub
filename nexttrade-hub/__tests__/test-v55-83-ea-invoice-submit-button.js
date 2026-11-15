var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/function getInvStatus\(row\) \{ return String\(\(row && row\.approval_status\) \|\| 'draft'\)/.test(r),'NULL status normalized to draft (getInvStatus)');
ok(/hpayload\.approval_status = 'draft';/.test(r),'new invoices explicitly set approval_status=draft');
ok(/if \(hpayload\.payment_status == null\) \{ hpayload\.payment_status = 'unpaid'; \}/.test(r),'new invoices default payment_status=unpaid');
// regressions: approve/reopen unchanged, silo stamp (DY) intact
ok(/canApprove: isInv && \(mayApprove \|\| isSuperAdmin\) && st === 'internal_review'/.test(r),'Approve eligibility via invActions');
ok(/if \(waveBiz\) \{ hpayload\.wave_business_id = waveBiz; \}/.test(r),'DY silo stamp still present');
ok(/version: 'v55\.83-EA'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EA');
console.log('\nv55.83-EA invoice submit button: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
