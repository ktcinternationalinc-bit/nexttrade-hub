const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const dash=p('src/components/AccountingDashboard.jsx');
const atab=p('src/components/AccountingTab.jsx');
const inv=p('src/components/AccountingInvoicesTab.jsx');
const page=p('src/app/page.jsx');

// 1) recent activity widget
ok(/from\('daily_log'\)/.test(dash)&&/log_category/.test(dash),'dashboard reads activity from daily_log');
ok(/accounting_invoices.*accounting_proformas.*accounting_customers.*bank_review/.test(dash.replace(/\n/g,' ')),'feed covers invoices/proformas/customers/bank-review categories');
ok(/Recent accounting activity/.test(dash)&&/a\.entry_text/.test(dash),'recent activity rendered');

// 2) Accounting tab
ok(/id: 'accounting'/.test(page)&&/AccountingTab/.test(page),'Accounting tab added + mounted');
ok(/accounting: 'Bank'/.test(page),'accounting tab gated via Bank permission');
ok(/'bank', 'accounting'/.test(page),'accounting hidden by default for users without Bank perm');
ok(/tab === 'accounting'/.test(page)&&/<AccountingTab /.test(page),'accounting tab renders wrapper');
// bank tab stripped of accounting screens
var bankSec=(page.match(/tab === 'bank' && \([\s\S]*?\)\}/)||[''])[0];
ok(/BankTab/.test(bankSec)&&!/AccountingDashboard/.test(bankSec)&&!/BankReviewTab/.test(bankSec)&&!/AccountingInvoicesTab/.test(bankSec),'Bank tab is Plaid-only (accounting moved out)');
// wrapper sub-tabs
ok(/'dashboard'/.test(atab)&&/'customers'/.test(atab)&&/'invoices'/.test(atab)&&/'proformas'/.test(atab)&&/'review'/.test(atab),'wrapper has all five sub-sections');
ok(/defaultMode="invoices"/.test(atab)&&/defaultMode="proformas"/.test(atab),'invoices + proformas split via defaultMode');
ok(/props\.defaultMode \|\| 'invoices'/.test(inv),'AccountingInvoicesTab honors defaultMode');

// 3) PDF relabel
ok(/Print \/ Save PDF/.test(inv)&&!/>PDF<\/button>/.test(inv),'PDF button relabeled Print / Save PDF');

ok(/version: 'v55\.83-AD'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AD');
ok(/>v55\.83-[A-Z]+</.test(page),'page stamped (current build)');

console.log('\nv55.83-AD accounting tab cleanup: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
