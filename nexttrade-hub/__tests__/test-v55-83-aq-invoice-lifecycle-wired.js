var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var inv=p('src/components/AccountingInvoicesTab.jsx');
ok(/invoiceLifecycle/.test(inv)&&/proformaLifecycle/.test(inv),'lifecycle rules imported');
ok(/doLcDelete/.test(inv)&&/doLcVoid/.test(inv)&&/doLcArchive/.test(inv)&&/doLcRestore/.test(inv),'all lifecycle handlers');
ok(/dbDelete\(lcTbl\(\)/.test(inv),'hard delete via dbDelete');
ok(/voidPatch\(userProfile && userProfile\.id, kind, reason\)/.test(inv),'void/cancel captures reason');
ok(/displayRows/.test(inv)&&/record_status/.test(inv),'archived/voided filtered from default list');
ok(/Show archived\/voided/.test(inv),'show-archived toggle');
ok(/canHardDelete/.test(inv)&&/canVoid/.test(inv)&&/canArchive/.test(inv)&&/canRestore/.test(inv),'all action buttons gated');
ok(/blockReason/.test(inv),'block reason shown when delete not allowed');
ok(/logActivity/.test(inv),'audit logging present');
ok(!/voidPatch[\s\S]{0,120}wave_invoice_id/.test(p('src/lib/record-lifecycle.js')),'void/archive never null wave ids (lib invariant)');
ok(p('src/app/page.jsx').indexOf('>v55.83-AQ<')>=0,'page AQ');
ok(/version: 'v55\.83-AQ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AQ');
console.log('\nv55.83-AQ invoice lifecycle wired: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
