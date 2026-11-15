var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var ar=p('src/components/AccountingCustomerHistory.jsx');var bt=p('src/components/BankTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/setCustomers\(scopeIfRegistered\(res\[0\]/.test(ar),'AR customers scoped to silo');
ok(/setPayments\(scopeIfRegistered\(res\[2\]/.test(ar),'AR payments scoped to silo');
ok(/setProformas\(scopeIfRegistered\(res\[3\]/.test(ar),'AR proformas scoped to silo');
ok(/setInvoices\(scopeIfRegistered\(res\[1\]/.test(ar),'AR invoices still scoped');
ok(/acctFilter !== 'all' && t\.account_id !== acctFilter/.test(bt),'Bank filters by selected account');
ok(/rangeCutoff/.test(bt) && /td < rangeCutoff/.test(bt),'Bank filters list by date range');
ok(/setAcctFilter/.test(bt) && /setViewRange/.test(bt),'Bank has account + range controls');
ok(/SYNC PULL/.test(bt),'pull selector relabeled to disambiguate');
ok(/const scopedTxns = transactions\.filter/.test(bt),'counts/cards derive from scoped (account+range) set');
ok(/matchedCount = scopedTxns\.filter/.test(bt) && /totalIn = scopedTxns\.filter/.test(bt),'matched count + cards use scoped set');
ok(/All \(\$\{scopedTxns\.length\}\)/.test(bt),'All tab badge uses scoped base');
ok(/bg-amber-50[^>]*>[\s\S]*?SYNC PULL/.test(bt) && /bg-slate-50[^>]*>[\s\S]*?VIEW/.test(bt),'pull (amber) vs view (slate) controls visually distinct');
ok(/version: 'v55\.83-EY'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EY');
console.log('\nv55.83-EY view filters: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
