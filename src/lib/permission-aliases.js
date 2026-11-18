// src/lib/permission-aliases.js — v55.83-UG (Codex QA 18:06). Client-safe (no imports): used by the server permission
// checks AND by Settings → Banking & Accounting Access, so the page shows exactly what the server allows.
// A switch can be stored under several names (canonical key, old label, older key). Rules:
//  • any name of a switch turned OFF → OFF (a newer OFF is never overridden by an old ON under another name);
//  • otherwise any name ON → ON; otherwise not set (null).
//  • 'accounting.view' (old "both hubs" key) can still GRANT either hub, but an OFF on one hub never turns off the other.
export var PERMISSION_ALIASES = {
  // ----- AR (first-class, NOT bundled into invoice view) -----
  'ar.view_summary': ['AR: View Summary', 'ar.view_summary', 'Finance: View Company Totals', 'finance.view_company_totals'],
  'ar.view_customer_balances': ['AR: View Customer Balances', 'ar.view_customer_balances', 'Finance: View All Customer Balances', 'finance.view_all_customer_balances'],
  'ar.view_invoice_balances': ['AR: View Invoice Balances', 'ar.view_invoice_balances', 'Invoice: View Balance', 'invoice.view_balance'],
  'ar.view_overdue': ['AR: View Overdue', 'ar.view_overdue'],
  'ar.export': ['AR: Export', 'ar.export'],
  'ar.full': ['AR: Full', 'ar.full', 'Finance: Admin', 'finance.admin'],
  // ----- Invoices / customers -----
  'invoices.view': ['Invoice: View', 'invoice.view'],
  'invoices.create': ['Invoice: Create', 'invoice.create'],
  'invoices.edit': ['Invoice: Edit', 'invoice.edit'],
  'invoices.approve': ['Invoice: Approve', 'invoice.approve'],
  'customers.view': ['Customer: View', 'customer.view'],
  'customers.create': ['Customer: Create', 'customer.create'],
  // ----- Bank / payments -----
  'bank_transactions.view': ['Bank: View Transactions', 'bank.view_transactions', 'Bank: View', 'bank.view'],
  // Balance visibility is resolved independently below; legacy aliases and
  // role wildcards never confer this protected capability.
  'bank_balances.view': [],
  'payments.match': ['Payments: Match', 'payments.match'],
  // v55.83-TP (Codex QA, Max Nov 17) — undoing a match is its OWN decision: 'match' no longer grants 'unmatch'
  'payments.unmatch': ['Payments: Unmatch', 'payments.unmatch'],
  'payments.mark_manual_done': ['Payments: Mark Manual Done', 'payments.mark_manual_done'],
  'categories.apply': ['Categories: Apply', 'categories.apply', 'Bank: Classify', 'bank.classify'],
  // ----- Wave sync authority (granular, per action) -----
  'wave.sync.view': ['Wave: Sync View', 'wave.sync.view'],
  'wave.sync.dry_run': ['Wave: Dry Run', 'wave.sync.dry_run'],
  'wave.sync.log.view': ['Wave: Sync Log View', 'wave.sync.log.view'],
  'wave.customers.push': ['Wave: Push Customers', 'wave.customers.push'],
  'wave.invoices.push': ['Wave: Push Invoices', 'wave.invoices.push'],
  'wave.payments.push': ['Wave: Push Payments', 'wave.payments.push'],
  'wave.categories.pull': ['Wave: Pull Categories', 'wave.categories.pull', 'categories.sync_from_wave'],
  'wave.import.run': ['Wave: Import', 'wave.import.run', 'wave.import'],
  'wave.settings.manage': ['Wave: Settings Manage', 'wave.settings.manage'],
  'wave.production.push': ['Wave: Production Push', 'wave.production.push'],
  // ----- v55.83-RF (Max, Nov 8 15:25: "2 switches with same permissioning for both") -----
  // 'accounting.view' = "may enter Accounting at all" = EITHER hub switch (or the retired RE key).
  'accounting.view': ['accounting.view', 'accounting.clickbooks.access', 'accounting.wavehub.access'],
  'accounting.clickbooks.access': ['accounting.clickbooks.access', 'accounting.view'],
  'accounting.wavehub.access': ['accounting.wavehub.access', 'accounting.view']
};

// v55.83-UG (Codex QA 18:19) — a name resolves to EVERY switch it belongs to, in both directions (invoice.create ↔ invoices.create ↔
// 'Invoice: Create'). The old both-hubs key 'accounting.view' never joins ClickBooks and Wave into one switch.
function canonicalsOf(name) {
  var out = []; var ks = Object.keys(PERMISSION_ALIASES);
  for (var i = 0; i < ks.length; i++) { var k = ks[i]; if (k === 'accounting.view' && name !== 'accounting.view') { continue; } if (k === name || PERMISSION_ALIASES[k].indexOf(name) >= 0) { out.push(k); } }
  return out;
}
// every name that can GRANT this switch
export function grantNames(perm) {
  var out = [perm]; var cs = canonicalsOf(perm);
  for (var i = 0; i < cs.length; i++) { var l = [cs[i]].concat(PERMISSION_ALIASES[cs[i]] || []); for (var j = 0; j < l.length; j++) { if (out.indexOf(l[j]) < 0) { out.push(l[j]); } } }
  return out;
}
// every name whose OFF turns this switch off (and that a toggle keeps in step)
export function permFamily(perm) {
  if (perm === 'accounting.view') { return ['accounting.view']; }
  return grantNames(perm).filter(function (n) { return n !== 'accounting.view'; });
}
// onMap / offMap: { name: true }. Returns true / false / null (not set).
export function effectiveSwitch(onMap, offMap, perm) {
  var fam = permFamily(perm); var i;
  for (i = 0; i < fam.length; i++) { if (offMap && offMap[fam[i]] === true) { return false; } }
  var g = grantNames(perm);
  for (i = 0; i < g.length; i++) { if (onMap && onMap[g[i]] === true) { return true; } }
  return null;
}
