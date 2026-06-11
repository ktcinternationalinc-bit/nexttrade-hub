const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const sql=p('sql/v55-83-ac-accounting-invoices.sql');
const inv=p('src/components/AccountingInvoicesTab.jsx');
const dash=p('src/components/AccountingDashboard.jsx');
const ui=p('src/components/BankReviewTab.jsx');
const page=p('src/app/page.jsx');
const atab=p('src/components/AccountingTab.jsx');

// SQL: 4 tables + key fields
ok(/CREATE TABLE IF NOT EXISTS accounting_invoices/.test(sql)&&/CREATE TABLE IF NOT EXISTS accounting_invoice_items/.test(sql)&&/CREATE TABLE IF NOT EXISTS accounting_proformas/.test(sql)&&/CREATE TABLE IF NOT EXISTS accounting_proforma_items/.test(sql),'four accounting doc tables');
['accounting_customer_id','invoice_number','due_date','total_amount','amount_paid','balance_due','payment_status','approval_status','ready_for_wave','approved_by'].forEach(function(c){ok(new RegExp(c).test(sql),'invoice field '+c);});
ok(/proforma_number/.test(sql)&&/valid_until/.test(sql)&&/converted_invoice_id/.test(sql)&&/status text DEFAULT 'draft'/.test(sql),'proforma fields incl converted_invoice_id');
ok(/line_total/.test(sql)&&/sku text/.test(sql)&&/product_ref text/.test(sql),'line items + SKU/product reserved');
ok(/business_id IN \(SELECT app_user_business_ids\(\)\)/.test(sql),'business-scoped RLS');
ok(/ai_del ON accounting_invoices FOR DELETE TO authenticated USING \(false\)/.test(sql),'invoice header deletion locked');

// invoice module
ok(/from\('accounting_invoices'\)/.test(inv)&&/from\('accounting_proformas'\)/.test(inv),'loads invoices + proformas');
ok(/accounting_customer_id/.test(inv)&&!/from\('invoices'\)/.test(inv),'uses accounting_customer_id, not Egypt invoices table');
ok(/setApproval\(row, 'internal_review'\)/.test(inv)&&/setApproval\(row, 'approved'\)/.test(inv)&&/ready_for_wave = true/.test(inv),'draft->review->approved + ready_for_wave');
ok(/mayApprove = canReopen/.test(inv)&&/Only an Owner\/Admin or Accounting Manager can approve/.test(inv),'approval restricted to owner/admin/accounting mgr');
ok(/function convertProforma/.test(inv)&&/status: 'converted', converted_invoice_id: invId/.test(inv),'proforma converts to invoice + sets converted_invoice_id');
ok(/function printDoc/.test(inv)&&/window\.print/.test(inv)&&/PROFORMA INVOICE/.test(inv),'PDF print for invoice + proforma');
ok(/docTotal\(/.test(inv)&&/itemTotal/.test(inv),'totals computed from line items');

// dashboard + masking
ok(/Open invoices/.test(dash)&&/Overdue invoices/.test(dash)&&/Unmatched bank txns/.test(dash)&&/Approvals pending/.test(dash)&&/Wave sync errors/.test(dash)&&/Deposits to allocate/.test(dash)&&/Payments received today/.test(dash),'all required dashboard widgets');
ok(/canSeeAmounts/.test(dash)&&/seeAmounts \? .* : '•••••'/.test(dash),'dashboard amounts masked without See Amounts');

// re-point
ok(/from\('accounting_invoices'\)/.test(ui),'matcher loads accounting invoices');
ok(/dbUpdate\('accounting_invoices', invId/.test(ui),'matcher recomputes accounting_invoices balance');
ok(/i\.accounting_customer_id === mCustomerId/.test(ui),'invoice picker filters by accounting customer (AB caveat resolved)');
ok(!/var inv = invoices\.find/.test(ui),'no Egypt invoices lookups remain');

// wired + version
ok(/<AccountingInvoicesTab /.test(atab)&&/<AccountingDashboard /.test(atab),'invoices + dashboard mounted via Accounting tab');
ok(/version: 'v55\.83-AC'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AC');
ok(/>v55\.83-[A-Z]+</.test(page),'page stamped (current build)');

console.log('\nv55.83-AC accounting invoices: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
