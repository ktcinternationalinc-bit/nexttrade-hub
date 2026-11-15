const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const sql=p('sql/v55-83-z-phase2-matching.sql');
const ui=p('src/components/BankReviewTab.jsx');
const perms=p('src/lib/bank-permissions.js');
const page=p('src/app/page.jsx');
const atab=p('src/components/AccountingTab.jsx');

// SQL tables + balances + RLS
ok(/CREATE TABLE IF NOT EXISTS payment_matches/.test(sql)&&/CREATE TABLE IF NOT EXISTS customer_credits/.test(sql)&&/CREATE TABLE IF NOT EXISTS unapplied_deposits/.test(sql),'three matching tables created');
ok(/ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid/.test(sql)&&/balance_due/.test(sql)&&/approval_status/.test(sql),'invoice balance + approval columns');
ok(/business_id IN \(SELECT app_user_business_ids\(\)\)/.test(sql),'business-scoped RLS');
ok(/pm_del ON payment_matches FOR DELETE TO authenticated USING \(false\)/.test(sql),'matches deletion locked');

// permission gates
ok(/canSeeAmounts/.test(perms)&&/canClassify/.test(perms)&&/canMatchPayments/.test(perms)&&/canEditMappings/.test(perms)&&/canViewBank/.test(perms),'all five permission gates present');
ok(/export var CLASSIFICATIONS/.test(perms)&&/customer_payment/.test(perms)&&/needs_clarification/.test(perms),'classification set defined');

// UI behaviors
ok(/canViewBank\(isSuperAdmin, modulePerms\)/.test(ui),'view gate enforced');
ok(/seeAmounts \? fmt\(/.test(ui)&&/maskAmount/.test(ui),'amounts masked without See Amounts');
ok(/classifyApplication\(invoiceTotal\(inv\), paidNow, apply\)/.test(ui),'uses validated matching math');
ok(/c\.overpayment > 0/.test(ui)&&/customer_credits/.test(ui),'overpayment -> customer credit');
ok(/unapplied_deposits/.test(ui),'park as unapplied deposit');
ok(/recomputeInvoice/.test(ui)&&/computeInvoiceBalance/.test(ui),'invoice balance recomputed from matches');
ok(/t\.business_id !== inv\.business_id/.test(ui),'cross-business match blocked (guardrail)');
ok(/review_status: 'approved'/.test(ui)&&/isLocked/.test(ui)&&/reopen/.test(ui),'approve locks; reopen exists');
ok(!/\.delete\(\)/.test(ui),'no delete of bank transactions in UI');
ok(/logActivity/.test(ui),'actions audit-logged');

// wired
ok(/<BankReviewTab /.test(atab)&&/import BankReviewTab/.test(atab),'mounted via Accounting tab wrapper');

ok(/version: 'v55\.83-Z'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew has v55.83-Z');
ok(/>v55\.83-[A-Z]+</.test(page),'page.jsx stamped (current build)');

console.log('\nv55.83-Z Phase 2: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
