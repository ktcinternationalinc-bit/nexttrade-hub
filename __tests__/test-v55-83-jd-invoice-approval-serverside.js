// ============================================================
// v55.83-JD — Invoice approval must persist. It was a browser dbUpdate on accounting_invoices, which
// RLS silently filtered to 0 rows (app auth by email, users.id != auth.uid()) — "Approve" toasted
// success but the invoice stayed DRAFT and could never push to Wave. Fix: service-role route +
// AccountingInvoicesTab routes setApproval/reopenInvoice through it. (THE "can't approve" P0.)
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/accounting/invoice-write/route.js');
var tab = rd('src/components/AccountingInvoicesTab.jsx');

ok('1: route is service-role + permission-gated (approve=invoices.approve, others=invoices.edit)',
  /SUPABASE_SERVICE_ROLE_KEY/.test(route) &&
  /var permKey = \(status === 'approved'\) \? 'invoices\.approve' : 'invoices\.edit'/.test(route) &&
  /assertPermission\(db, by, permKey, req\)/.test(route));
ok('2: route writes accounting_invoices with select() + fails loud on 0 rows (no silent RLS drop)',
  /from\('accounting_invoices'\)\.update\(patch\)\.eq\('id', invoiceId\)\.select\(\)/.test(route) &&
  /No invoice row updated/.test(route));
ok('3: route verifies the status read back (approved means approved)',
  /if \(row\.approval_status !== status\)/.test(route) && /did not read back as/.test(route));
ok('4: approved sets approved_by/approved_at/ready_for_wave',
  /patch\.approved_by = by; patch\.approved_at = new Date\(\)\.toISOString\(\); patch\.ready_for_wave = true/.test(route));
ok('5: reopen action is gated on invoices.approve and writes internal_review',
  /action === 'reopen'/.test(route) && /approval_status: 'internal_review'/.test(route) && /assertPermission\(db, by, 'invoices\.approve', req\)/.test(route));

ok('6: AccountingInvoicesTab.setApproval calls the service route (no direct dbUpdate on approval)',
  /fetch\('\/api\/accounting\/invoice-write'[\s\S]{0,200}action: 'set_approval'/.test(tab));
ok('7: setApproval throws on !j.ok so a silent 0-row no longer reads as success',
  /if \(!j \|\| !j\.ok\) \{ throw new Error\(\(j && j\.error\) \|\| 'approval did not save'\)/.test(tab));
ok('8: reopenInvoice also routes through the service route',
  /fetch\('\/api\/accounting\/invoice-write'[\s\S]{0,200}action: 'reopen'/.test(tab));
ok('9: approval no longer uses the RLS-trapped browser dbUpdate on accounting_invoices',
  !/dbUpdate\('accounting_invoices', row\.id, patch/.test(tab) && !/dbUpdate\('accounting_invoices', row\.id, rpatch/.test(tab));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JD invoice-approval tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
