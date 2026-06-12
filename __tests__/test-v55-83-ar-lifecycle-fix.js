var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var sql=p('sql/v55-83-ar-lifecycle-fix.sql');
ok(/ADD COLUMN IF NOT EXISTS record_status/.test(sql)&&/void_reason/.test(sql),'re-adds lifecycle columns (idempotent)');
ok(/CREATE POLICY ac_del ON accounting_customers FOR DELETE TO authenticated USING \(true\)/.test(sql),'customer DELETE reopened');
ok(/CREATE POLICY ai_del ON accounting_invoices FOR DELETE TO authenticated USING \(true\)/.test(sql),'invoice DELETE reopened');
ok(/CREATE POLICY ap_del ON accounting_proformas FOR DELETE TO authenticated USING \(true\)/.test(sql),'proforma DELETE reopened');
var c=p('src/components/AccountingCustomersTab.jsx');var i=p('src/components/AccountingInvoicesTab.jsx');
ok(/Show archived customers/.test(c)&&/bg-slate-800 border/.test(c),'customer toggle now visible button');
ok(/Show archived\/voided/.test(i)&&/bg-slate-800 border border-slate-600 rounded px-3 py-1.5 cursor-pointer/.test(i),'invoice toggle now visible button');
ok(p('src/app/page.jsx').indexOf('>v55.83-AR<')>=0,'page AR');
ok(/version: 'v55\.83-AR'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AR');
console.log('\nv55.83-AR lifecycle fix: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
