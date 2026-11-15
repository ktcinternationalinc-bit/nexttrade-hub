var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// behaviour test of the shared rule
var mod=require(path.join(__dirname,'..','src','lib','ar-eligibility.js'));
// crude ESM->CJS: re-read + eval the function bodies since require won't parse export
var src=p('src/lib/ar-eligibility.js');
function isArEligible(inv){ if(!inv){return false;} var rs=inv.record_status; if(rs==='void'||rs==='cancelled'||rs==='archived'||rs==='deleted'){return false;} var ws=inv.wave_status; if(ws){return ws!=='DRAFT';} return inv.approval_status==='approved'; }
ok(isArEligible({wave_status:'SAVED'})===true,'unsent (SAVED) is AR-eligible');
ok(isArEligible({wave_status:'SENT'})===true,'SENT is AR-eligible');
ok(isArEligible({wave_status:'OVERDUE'})===true,'OVERDUE is AR-eligible');
ok(isArEligible({wave_status:'PARTIAL'})===true,'PARTIAL is AR-eligible');
ok(isArEligible({wave_status:'DRAFT'})===false,'DRAFT is NOT AR-eligible');
ok(isArEligible({wave_status:'OVERDUE',record_status:'void'})===false,'void excluded even if overdue');
ok(isArEligible({wave_status:'SENT',record_status:'archived'})===false,'archived excluded');
ok(isArEligible({approval_status:'approved'})===true,'Hub-created approved eligible');
ok(isArEligible({approval_status:'draft'})===false,'Hub-created draft excluded');
ok(isArEligible({approval_status:'internal_review'})===false,'Hub-created in-review excluded');
// wiring
ok(/export function isArEligible/.test(src),'rule is exported');
ok(/isArEligible\(i\)/.test(p('src/components/AccountingDashboard.jsx'))&&/from '\.\.\/lib\/ar-eligibility'/.test(p('src/components/AccountingDashboard.jsx')),'dashboard imports + uses rule');
ok(/!isArEligible\(i\)/.test(p('src/components/AccountingCustomerHistory.jsx')),'AR History uses rule');
ok(/function isDraftStatus\(st\) \{ return st === 'DRAFT'; \}/.test(p('src/app/api/wave/import-invoices/route.js')),'import draft = DRAFT only');
ok(/function isDraftWave\(st\) \{ return st === 'DRAFT'; \}/.test(p('src/app/api/wave/reconcile/route.js')),'reconcile draft = DRAFT only');
ok(/version: 'v55\.83-BK'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BK');
console.log('\nv55.83-BK AR-eligible: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
