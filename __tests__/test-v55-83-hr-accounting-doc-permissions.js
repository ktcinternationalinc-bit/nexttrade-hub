// ============================================================
// v55.83-HR — Accounting document tabs must NOT be gated by bank.view.
//
// P0 bug (Codex): Invoices, Proformas, Accounting Customers, Company Profile,
// Customer AR History, and Purchase Orders were gated by canViewBank (bank.view),
// forcing admins to grant Bank: View just to let staff work documents.
//
// Fix: explicit document permissions (ACCT-001..007). bank.view now only controls
// Bank Review & Matching and must NOT imply document access.
//
// These tests lock the helper semantics + the source wiring.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// Load bank-permissions.js pure functions (ESM → strip exports + eval).
var permSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'bank-permissions.js'), 'utf8');
var evalSrc = permSrc.replace(/export\s+/g, '');
// eslint-disable-next-line no-eval
eval(evalSrc);

// ---------- 1. invoice.view opens invoices WITHOUT bank.view ----------
ok('1a: invoice.view grants canViewInvoices', canViewInvoices(false, { 'invoice.view': true }, 'staff') === true);
ok('1b: invoice.view does NOT grant canViewBank', canViewBank(false, { 'invoice.view': true }) === false);
ok('1c: bank.view ALONE does NOT grant invoice view (no implied doc access)', canViewInvoices(false, { 'bank.view': true }, 'staff') === false);
ok('1d: legacy "Edit Invoices" still opens invoices (no lockout)', canViewInvoices(false, { 'Edit Invoices': true }, 'staff') === true);
ok('1e: no relevant perm → restricted', canViewInvoices(false, {}, 'staff') === false);

// ---------- 2. customers / company profile / POs ----------
ok('2a: accounting.customers.view grants customers, not bank', canViewAccountingCustomers(false, { 'accounting.customers.view': true }, 'staff') === true && canViewBank(false, { 'accounting.customers.view': true }) === false);
ok('2b: bank.view alone does NOT grant customers', canViewAccountingCustomers(false, { 'bank.view': true }, 'staff') === false);
ok('2c: accounting.company_profile.view grants company profile, not bank', canViewCompanyProfile(false, { 'accounting.company_profile.view': true }, 'staff') === true && canViewBank(false, { 'accounting.company_profile.view': true }) === false);
ok('2d: purchase_orders.view grants POs, not bank', canViewPurchaseOrders(false, { 'purchase_orders.view': true }, 'staff') === true && canViewBank(false, { 'purchase_orders.view': true }) === false);
ok('2e: bank.view alone does NOT grant POs', canViewPurchaseOrders(false, { 'bank.view': true }, 'staff') === false);

// ---------- 3. Bank Review STILL needs bank.view ----------
ok('3a: bank.view opens Bank Review', canViewBank(false, { 'bank.view': true }) === true);
ok('3b: no bank.view → Bank Review blocked', canViewBank(false, { 'invoice.view': true }) === false);

// ---------- 4. super_admin / admin always pass ----------
ok('4a: super_admin sees invoices', canViewInvoices(true, {}, null) === true);
ok('4b: admin role sees invoices without explicit key', canViewInvoices(false, {}, 'admin') === true);

// ---------- 5. source wiring — doc tabs no longer gate mayView on canViewBank ----------
function gateUsesBank(file) {
  var s = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', file), 'utf8');
  return /var mayView = canViewBank\(/.test(s);
}
ok('5a: AccountingInvoicesTab mayView not canViewBank', !gateUsesBank('AccountingInvoicesTab.jsx'));
ok('5b: AccountingCustomersTab mayView not canViewBank', !gateUsesBank('AccountingCustomersTab.jsx'));
ok('5c: AccountingCustomerHistory mayView not canViewBank', !gateUsesBank('AccountingCustomerHistory.jsx'));
ok('5d: CompanyProfileTab mayView not canViewBank', !gateUsesBank('CompanyProfileTab.jsx'));
ok('5e: PurchaseOrdersTab mayView not canViewBank', !gateUsesBank('PurchaseOrdersTab.jsx'));
ok('5f: BankReviewTab STILL uses canViewBank (correct)', /canViewBank\(/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'BankReviewTab.jsx'), 'utf8')));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-HR accounting-doc-permission tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
