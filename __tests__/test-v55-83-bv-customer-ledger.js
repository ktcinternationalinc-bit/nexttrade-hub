var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/CustomerLedger.jsx');
// uses shared rule + correct imports
ok(/from '..\/lib\/ar-eligibility'/.test(r)&&/isArEligible/.test(r),'uses shared isArEligible rule');
ok(/import React, \{ useState/.test(r),'React imported at top for Fragment');
ok(/canViewCustomerAr|canViewInvoices/.test(r),'permission helpers imported');
ok(/isSuperAdmin \|\| canViewCustomerAr.*\|\| canViewInvoices/.test(r),'permission gate');
// balance formula
ok(/num\(inv\.total_amount\) - num\(inv\.wave_imported_paid\) - hubPaid\(inv\.id\)/.test(r),'invoice balance = total - wave_imported - hub paid');
ok(/Credits 0\.00 . Deductions 0\.00/.test(r),'credits/deductions shown as 0 honestly');
// draft separated, not in AR
ok(/if \(isDraftInv\(i\)\) \{ s\.draftValue/.test(r),'drafts separated from AR totals');
ok(/if \(!isArEligible\(i\)\) return;/.test(r),'non-eligible excluded from AR');
// currency separation
ok(/keep currencies separate|no cross-currency|kept separate/i.test(r),'currencies kept separate');
ok(/var \[currency, setCurrency\]/.test(r),'currency selector state');
// wave-compat surfaced
ok(/sync_status/.test(r)&&/wave_payment_id/.test(r),'wave sync status + payment id surfaced');
// export/print
ok(/function printStatement/.test(r)&&/function exportCsv/.test(r),'print + CSV');
ok(/Running Balance/.test(r),'running statement');
// wiring
var at=p('src/components/AccountingTab.jsx');
ok(/import CustomerLedger from '.\/CustomerLedger'/.test(at)&&/sub === 'ledger' && <CustomerLedger/.test(at),'wired into AccountingTab');
ok(/version: 'v55\.83-BV'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BV');
// BEHAVIORAL: the actual AR rule (the heart of the correction)
var arSrc=p('src/lib/ar-eligibility.js');
var mod={};(function(){var exports={};eval(arSrc.replace(/export function/g,'exports.X=function').replace(/exports\.X=function (\w+)/g,'exports.$1=function $1'));mod=exports;})();
ok(mod.isArEligible({wave_status:'SAVED'})===true,'BEHAVIOR: Unsent (SAVED) COUNTS in AR');
ok(mod.isArEligible({wave_status:'DRAFT'})===false,'BEHAVIOR: Draft excluded from AR');
ok(mod.isArEligible({wave_status:'OVERDUE'})===true,'BEHAVIOR: Overdue counts');
ok(mod.isArEligible({wave_status:'SENT',record_status:'archived'})===false,'BEHAVIOR: archived excluded even if sent');
ok(mod.isArEligible({record_status:'void',wave_status:'PAID'})===false,'BEHAVIOR: void excluded');
console.log('\nv55.83-BV customer ledger: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
