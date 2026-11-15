var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var br=p('src/components/BankReviewTab.jsx');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// GPT confirmation list — assert each guard exists
ok(/if \(t\.direction === 'out'\) \{ toast\.error\('This is an OUTGOING transaction \(money out\)/.test(br),'applyToInvoice blocks direction!==in');
ok(/Split lines cannot be linked to a customer invoice on money-out/.test(br),'split matching blocks direction!==in');
ok(/_orphan_bank === true/.test(wsc) && /Bank deposit not found/.test(wsc),'orphaned payment blocked in sync');
// unmatch fix: separate stamps, payment gets sync_status, matches does not
ok(/var payStamp = \{ voided: true, sync_status: 'void'/.test(br),'payment stamp sets voided+sync_status void');
ok(/var matchStamp = \{ voided: true, voided_at: payStamp\.voided_at, voided_by: payStamp\.voided_by \}/.test(br),'match stamp omits sync_status (no such column)');
ok(/payment_matches'\)\.update\(matchStamp\)/.test(br),'unmatch uses matchStamp for payment_matches');
ok(/payment_matches void non-fatal/.test(br),'payment_matches void is non-fatal (recompute always runs)');
ok(/isPaymentVoid/.test(br),'recompute excludes voided/void rows');
ok(/sel\[q\.key\] && !q\.blocked/.test(wsc),'orphaned/contaminated cannot be selected for push');
// contaminated guard
ok(/contaminatedCust = \{/.test(wsc) && /46bfbd33-47e0-442b-9a51-98ba19b3ed3d/.test(wsc),'known contaminated customers set');
ok(/wrong or unregistered Wave silo/.test(wsc),'contaminated payment blocked with reason');
ok(/version: 'v55\.83-FK'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FK');
console.log('\nv55.83-FK prevention lock: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
