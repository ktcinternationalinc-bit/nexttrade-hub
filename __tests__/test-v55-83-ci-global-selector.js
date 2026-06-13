var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var at=p('src/components/AccountingTab.jsx');
ok(/import WaveBusinessFilter/.test(at),'AccountingTab imports the selector');
ok(/<WaveBusinessFilter onChange=\{function \(b\) \{ setWaveKey/.test(at),'global selector rendered in header');
// every scoped sub-tab keyed by waveKey so it remounts on business change
['acct-dash','acct-arh','acct-led','acct-cus','acct-inv','acct-pf','acct-rev'].forEach(function(k){
  ok(new RegExp("key=\\{'"+k+"\\|' \\+ waveKey\\}").test(at), k+' remounts on business change');
});
ok(/onOpenBankReview=\{function \(\) \{ setSub\('review'\); \}\}/.test(at),'dashboard wired to open Bank Review');
var dash=p('src/components/AccountingDashboard.jsx');
ok(/Open Bank Review/.test(dash) && /props\.onOpenBankReview/.test(dash),'dashboard has Open Bank Review button');
// list tabs read the global active business, no in-tab filter
var inv=p('src/components/AccountingInvoicesTab.jsx');
ok(!/WaveBusinessFilter/.test(inv),'Invoices tab has no duplicate in-tab selector');
ok(/var waveBiz = getActiveWaveBusiness\(\) \|\| ''/.test(inv),'Invoices reads global active business');
ok(/scopeIfRegistered\(\(isInvoice\(\) \? invoices : proformas\)/.test(inv),'Invoices still scoped');
var cus=p('src/components/AccountingCustomersTab.jsx');
ok(!/WaveBusinessFilter/.test(cus),'Customers tab has no duplicate in-tab selector');
ok(/var waveBiz = getActiveWaveBusiness\(\) \|\| ''/.test(cus),'Customers reads global active business');
ok(/scopeIfRegistered\(rows, waveBiz, waveReg/.test(cus),'Customers still scoped');
ok(/version: 'v55\.83-CI'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CI');
console.log('\nv55.83-CI global selector: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
