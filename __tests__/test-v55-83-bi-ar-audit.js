var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/app/api/wave/reconcile/route.js');var ui=p('src/components/WaveImportTab.jsx');
ok(!/`|\blet \b|\bconst |=>/.test(r),'reconcile route still SWC-safe');
ok(/total\{ value currency\{ code \} \}/.test(r)&&/customer\{ id name \}/.test(r),'Wave query pulls currency + customer');
ok(/function buildConverter/.test(r)&&/idx\['USD>' \+ cur\]/.test(r)&&/amount \/ rUsdToCur/.test(r),'date-matched FX converter (USD>cur => divide)');
ok(/isDraftWave/.test(r)&&/function isDraftWave\(st\) \{ return st === 'DRAFT';/.test(r),'identifies Wave drafts (DRAFT only; unsent counts)');
ok(/h\.approval_status !== 'approved'/.test(r)&&/hubLive\(h\)/.test(r),'AR scope = Hub live + approved (mirrors dashboard)');
ok(/currentNative/.test(r)&&/draftNative/.test(r)&&/exDraftNative/.test(r)&&/voidishNative/.test(r)&&/normalizedUsd/.test(r),'AR ladder: current/drafts/exDraft/voidish/normalizedUsd');
ok(/byCurrencyNative/.test(r)&&/unconvertibleNative/.test(r),'reports by-currency + unconvertible');
ok(/topCustomers/.test(r)&&/afterCurrencyFix/.test(r)&&/afterDraftExclusion/.test(r)&&/finalCorrect/.test(r),'top-20 customers with 4 balance columns');
ok(/arAudit: ar/.test(r)&&/topCustomers: topCustomers/.test(r),'audit returned in report');
ok(!/arAudit[\s\S]{0,4000}\.insert\(|arAudit[\s\S]{0,4000}\.update\(/.test(r),'AR audit performs no writes');
ok(/AR integrity/.test(ui)&&/AFTER CURRENCY NORMALIZATION/.test(ui)&&/Top 20 customers/.test(ui),'UI panel: ladder + top-20');
ok(/version: 'v55\.83-BI'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BI');
console.log('\nv55.83-BI AR audit: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
