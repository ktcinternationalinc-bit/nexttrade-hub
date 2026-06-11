const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const sql=p('sql/v55-83-ah-company-profile.sql');
const cp=p('src/components/CompanyProfileTab.jsx');
const inv=p('src/components/AccountingInvoicesTab.jsx');
const atab=p('src/components/AccountingTab.jsx');

ok(/CREATE TABLE IF NOT EXISTS company_profile/.test(sql),'company_profile table');
['company_name','address','phone','email','website','tax_id','default_invoice_notes','default_proforma_notes','default_payment_terms','logo_data_url'].forEach(function(c){ok(new RegExp(c).test(sql),'profile field '+c);});
ok(/FOR INSERT TO authenticated WITH CHECK \(true\)/.test(sql),'company_profile uses open RLS (saves work)');
ok(/wave_invoice_id/.test(sql)&&/wave_sync_status/.test(sql)&&/wave_estimate_id/.test(sql),'Wave-compat columns added');

ok(/from\('company_profile'\)/.test(cp)&&/dbInsert\('company_profile'/.test(cp),'company profile reads + saves');
ok(/readAsDataURL/.test(cp)&&/logo_data_url/.test(cp),'logo upload to base64');
ok(/canEditMappings/.test(cp),'edit gated');

ok(/var compLines = \[c\.address/.test(inv)&&/logoHtml/.test(inv),'print uses company info + logo');
ok(/Amount paid/.test(inv)&&/Balance due/.test(inv),'invoice print shows paid + balance');
ok(/Customer signature/.test(inv)&&/Authorized signature/.test(inv),'signature areas present');
ok(/company_profile/.test(inv),'invoices component loads company profile');

ok(/'company', '🏢 Company Profile'/.test(atab)&&/<CompanyProfileTab /.test(atab),'company profile is an Accounting sub-tab');

ok(/>v55\.83-AH</.test(p('src/app/page.jsx')),'page stamped AH');
ok(/version: 'v55\.83-AH'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AH');
console.log('\nv55.83-AH company profile: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
