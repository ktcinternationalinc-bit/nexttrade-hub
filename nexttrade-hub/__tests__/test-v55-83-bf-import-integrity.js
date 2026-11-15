var fs=require('fs');var path=require('path');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var SRC=path.join(__dirname,'..','src');
function walk(dir,out){ fs.readdirSync(dir).forEach(function(n){ var fp=path.join(dir,n); var st=fs.statSync(fp); if(st.isDirectory()) walk(fp,out); else if(/\.(jsx?|js)$/.test(n)) out.push(fp); }); return out; }
var files=walk(SRC,[]);

// 1) helper exports correctly
var helper=fs.readFileSync(path.join(SRC,'lib','fetch-all-rows.js'),'utf8');
ok(/export function fetchAllRows/.test(helper),'fetchAllRows is exported');

// 2) GENERAL GUARD: any file that CALLS fetchAllRows must import it.
// Exclude WhatsNewWidget.jsx (changelog text only) and the helper file itself.
var offenders=[];
files.forEach(function(fp){
  if(/WhatsNewWidget\.jsx$/.test(fp)) return;
  if(/fetch-all-rows\.js$/.test(fp)) return;
  var s=fs.readFileSync(fp,'utf8');
  var calls=/fetchAllRows\s*\(/.test(s);
  if(!calls) return;
  var imported=/import\s*\{[^}]*\bfetchAllRows\b[^}]*\}\s*from\s*'[^']*fetch-all-rows'/.test(s);
  if(!imported) offenders.push(path.relative(SRC,fp));
});
ok(offenders.length===0,'every file calling fetchAllRows imports it (offenders: '+offenders.join(', ')+')');

// 3) explicit: the four known consumers import it
['components/BankReviewTab.jsx','components/AccountingInvoicesTab.jsx','components/AccountingCustomerHistory.jsx','components/AccountingDashboard.jsx'].forEach(function(rel){
  var s=fs.readFileSync(path.join(SRC,rel),'utf8');
  ok(/import\s*\{[^}]*fetchAllRows[^}]*\}\s*from\s*'\.\.\/lib\/fetch-all-rows'/.test(s),rel+' imports fetchAllRows');
});

console.log('\nv55.83-BF import integrity: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
