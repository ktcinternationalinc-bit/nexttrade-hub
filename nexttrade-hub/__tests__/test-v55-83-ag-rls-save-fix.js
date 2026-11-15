const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const sql=p('sql/v55-83-ag-rls-fix.sql');
const cust=p('src/components/AccountingCustomersTab.jsx');
const inv=p('src/components/AccountingInvoicesTab.jsx');

// the fix opens SELECT/INSERT/UPDATE and stops relying on auth.uid()
ok(/FOR SELECT TO authenticated USING \(true\)/.test(sql)&&/FOR INSERT TO authenticated WITH CHECK \(true\)/.test(sql)&&/FOR UPDATE TO authenticated USING \(true\)/.test(sql),'SELECT/INSERT/UPDATE reopened (saves unblocked)');
ok(!/app_user_business_ids/.test(sql),'fix no longer keys policies off auth.uid()/membership');
ok(/rec_tables/.test(sql)&&/accounting_customers/.test(sql)&&/accounting_invoices/.test(sql)&&/payment_matches/.test(sql)&&/bank_transactions/.test(sql),'covers all blocked accounting + bank tables');
ok(/FOR DELETE TO authenticated USING \(false\)/.test(sql),'financial record deletes stay locked');
ok(/item_tables/.test(sql)&&/accounting_invoice_items/.test(sql),'item tables allow delete for editing');
ok(/UPDATE accounting_customers SET business_id/.test(sql),'business_id backfilled on records saved while blocked');

// errors surface (no silent failure)
ok(/console\.error\('\[save\]/.test(cust)&&/console\.error\('\[save\]/.test(inv),'save failures logged to console');
ok(/check console/.test(cust)||/unknown error/.test(cust),'user sees a real error message on failure');

ok(/>v55\.83-AG</.test(p('src/app/page.jsx')),'page stamped AG');
ok(/version: 'v55\.83-AG'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AG');
console.log('\nv55.83-AG save fix: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
