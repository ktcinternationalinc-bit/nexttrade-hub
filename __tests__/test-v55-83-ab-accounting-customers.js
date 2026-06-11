const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const sql=p('sql/v55-83-ab-accounting-customers.sql');
const cust=p('src/components/AccountingCustomersTab.jsx');
const ui=p('src/components/BankReviewTab.jsx');
const page=p('src/app/page.jsx');

// tables + fields
ok(/CREATE TABLE IF NOT EXISTS accounting_customers/.test(sql)&&/CREATE TABLE IF NOT EXISTS accounting_customer_contacts/.test(sql)&&/CREATE TABLE IF NOT EXISTS accounting_customer_addresses/.test(sql),'three accounting customer tables');
['business_id','company_name','contact_name','billing_address','shipping_address','email','phone','tax_id','status','credit_limit','notes','wave_customer_id','sync_status'].forEach(function(col){ ok(new RegExp(col).test(sql),'field '+col+' present'); });
// re-point columns
ok(/bank_transactions  ADD COLUMN IF NOT EXISTS accounting_customer_id/.test(sql)&&/payment_matches    ADD COLUMN IF NOT EXISTS accounting_customer_id/.test(sql)&&/customer_credits   ADD COLUMN IF NOT EXISTS accounting_customer_id/.test(sql)&&/unapplied_deposits ADD COLUMN IF NOT EXISTS accounting_customer_id/.test(sql),'accounting_customer_id added to all four workflow tables');
// RLS + delete lock
ok(/business_id IN \(SELECT app_user_business_ids\(\)\)/.test(sql),'business-scoped RLS');
ok(/ac_del ON accounting_customers FOR DELETE TO authenticated USING \(false\)/.test(sql),'customer deletion locked');

// CRUD UI
ok(/from\('accounting_customers'\)/.test(cust)&&/dbInsert\('accounting_customers'/.test(cust),'customer screen reads + inserts master');
ok(/canEditMappings/.test(cust)&&/mayEdit/.test(cust),'edit gated by Edit Mappings');
ok(/not copied/.test(cust)||/not[\s\S]{0,40}copied/.test(cust),'states Egypt CRM is not copied in');
ok(/from\('businesses'\)/.test(cust),'resolves business id for RLS-valid insert');

// BankReviewTab re-pointed
ok(/from\('accounting_customers'\)/.test(ui),'review tab loads accounting customers');
ok(/accounting_customer_id: mCustomerId/.test(ui),'matches write accounting_customer_id');
ok(!/ customer_id: mCustomerId/.test(ui),'no bare CRM customer_id writes remain in matcher');
ok(/items=\{acctCustomers\}/.test(ui)&&!/items=\{customers\}/.test(ui),'pickers use accounting customers, not CRM');

// wired
ok(/<AccountingCustomersTab /.test(p('src/components/AccountingTab.jsx'))&&/import AccountingCustomersTab/.test(p('src/components/AccountingTab.jsx')),'customer master mounted via Accounting tab');
ok(/version: 'v55\.83-AB'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AB');
ok(/>v55\.83-[A-Z]+</.test(page),'page stamped (current build)');

console.log('\nv55.83-AB accounting customers: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
