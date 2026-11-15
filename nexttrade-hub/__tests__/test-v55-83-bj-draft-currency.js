var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var imp=p('src/app/api/wave/import-invoices/route.js');
var dash=p('src/components/AccountingDashboard.jsx');
var arh=p('src/components/AccountingCustomerHistory.jsx');
var sql=p('sql/v55-83-bj-wave-status-currency.sql');
// import
ok(!/`|\blet \b|\bconst |=>/.test(imp),'import route SWC-safe');
ok(/function isDraftStatus\(st\) \{ return st === 'DRAFT';/.test(imp),'import draft = DRAFT only (Saved is approved)');
ok(/wave_status: n\.status/.test(imp)&&/currency: curOf\(n\)/.test(imp),'import stores wave_status + currency');
ok(/approval_status: isDraftStatus\(n\.status\) \? 'draft' : 'approved'/.test(imp),'Wave drafts imported as draft (not approved)');
ok(/total\{ value currency\{ code \} \}/.test(imp),'import pulls currency from Wave');
// dashboard
ok(/isArEligible\(i\)/.test(dash),'dashboard AR uses shared isArEligible (drafts excluded, unsent included)');
ok(/if \(cur !== 'USD'\)/.test(dash)&&/return;/.test(dash)&&/nonUsd\[cur\]/.test(dash),'dashboard separates non-USD (returns before USD AR)');
ok(/Open AR \(USD\)/.test(dash)&&/Receivables in other currencies/.test(dash),'dashboard labels USD + shows other-currency cards');
ok(/nonUsd: nonUsdList/.test(dash),'dashboard exposes nonUsd buckets');
// AR history
ok(/!isArEligible\(i\)/.test(arh),'AR History uses shared isArEligible');
ok(/'archived' \|\| s === 'deleted'/.test(arh),'AR History excludes archived/deleted');
ok(/\(i\.currency \|\| 'USD'\) !== 'USD'\) return/.test(arh),'AR History keeps currencies separate');
// sql
ok(/wave_status text/.test(sql)&&/currency\s+text DEFAULT 'USD'/.test(sql),'SQL adds wave_status + currency');
ok(/version: 'v55\.83-BJ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BJ');
console.log('\nv55.83-BJ draft+currency: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
