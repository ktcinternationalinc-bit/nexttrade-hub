// src/lib/server-permissions.js — SERVER-SIDE permission resolution for API routes.
// The Hub is a protective overlay: routes must enforce the SPECIFIC permission server-side,
// not trust the frontend. super_admin resolves to ALL permissions; everyone else is checked
// against their module_permissions grants (and, temporarily, a role->permission map so we
// don't hardcode super_admin-only checks we'd have to rip out later).
// SWC-safe: var + string concat, no arrows/const/template-literals.
//
// Usage in a route:
//   var perm = await assertPermission(db, userId, 'wave.payments.push', request);
//   if (!perm.ok) { return Response.json({ ok:false, error: perm.error }, { status: perm.status }); }
//
// CRON_SECRET bearer bypasses the check (scheduled jobs are trusted).

// Canonical permission keys (the final model). Each maps to one or more module_permissions
// names that may grant it (so existing grants keep working).
var PERMISSION_ALIASES = {
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
  'bank_balances.view': ['Bank: View Account Balances', 'bank.view_account_balances', 'Finance: Admin', 'finance.admin'],
  'payments.match': ['Payments: Match', 'payments.match'],
  'payments.unmatch': ['Payments: Unmatch', 'payments.unmatch', 'Payments: Match', 'payments.match'],
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
  'wave.production.push': ['Wave: Production Push', 'wave.production.push']
};

// TEMPORARY role->permission map (emergency launch). Lets us grant whole roles a sensible
// default without a permissions UI yet. super_admin is handled separately (gets everything).
// Replace/extend via module_permissions grants over time; do NOT hardcode super_admin in routes.
var ROLE_DEFAULTS = {
  owner: ['*'],
  admin: ['*'],
  accounting_manager: [
    'ar.view_summary', 'ar.view_customer_balances', 'ar.view_invoice_balances', 'ar.view_overdue', 'ar.export',
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.approve', 'customers.view', 'customers.create',
    'bank_transactions.view', 'payments.match', 'payments.unmatch', 'payments.mark_manual_done', 'categories.apply',
    'wave.sync.view', 'wave.sync.dry_run', 'wave.sync.log.view', 'wave.customers.push', 'wave.invoices.push',
    'wave.payments.push', 'wave.categories.pull', 'wave.import.run'
  ],
  ar_lead: [
    'ar.view_summary', 'ar.view_invoice_balances', 'ar.view_overdue',
    'invoices.view', 'invoices.create', 'customers.view',
    'bank_transactions.view', 'payments.match',
    'wave.sync.view', 'wave.sync.dry_run', 'wave.sync.log.view', 'wave.invoices.push', 'wave.payments.push'
  ],
  bank_reviewer: [
    'bank_transactions.view', 'payments.match', 'categories.apply', 'ar.view_invoice_balances', 'wave.sync.view'
  ],
  viewer: ['invoices.view', 'customers.view']
};

function aliasesFor(perm) { return PERMISSION_ALIASES[perm] || [perm]; }

function mpHas(mpMap, perm) {
  if (!mpMap) { return false; }
  var keys = aliasesFor(perm);
  var i;
  for (i = 0; i < keys.length; i++) { if (mpMap[keys[i]] === true) { return true; } }
  return false;
}

function roleHas(role, perm) {
  if (!role) { return false; }
  var list = ROLE_DEFAULTS[role];
  if (!list) { return false; }
  if (list.indexOf('*') >= 0) { return true; }
  return list.indexOf(perm) >= 0;
}

// Loads the user's role + module_permissions and returns a resolver.
export async function loadUserPermissions(db, userId) {
  var role = null;
  var mpMap = {};
  if (!userId) { return { role: null, isSuperAdmin: false, mp: mpMap }; }
  try {
    var uRes = await db.from('users').select('id, role').eq('id', userId).limit(1);
    var u = uRes && uRes.data && uRes.data[0];
    role = u ? u.role : null;
  } catch (eU) { role = null; }
  try {
    var mpRes = await db.from('module_permissions').select('module_name, has_access').eq('user_id', userId);
    var rows = (mpRes && mpRes.data) || [];
    var i;
    for (i = 0; i < rows.length; i++) { if (rows[i].has_access === true) { mpMap[rows[i].module_name] = true; } }
  } catch (eM) { mpMap = {}; }
  return { role: role, isSuperAdmin: role === 'super_admin', mp: mpMap };
}

export function userHasPermission(ctx, perm) {
  if (!ctx) { return false; }
  if (ctx.isSuperAdmin === true) { return true; }       // super_admin = all
  if (mpHas(ctx.mp, perm)) { return true; }              // explicit grant
  if (roleHas(ctx.role, perm)) { return true; }          // temporary role default
  return false;
}

// Only these permissions may be satisfied by the CRON_SECRET bearer, because only these are
// performed by genuine scheduled backend jobs (sync-pull import, scheduled category pull).
// Staff-only actions (payment/customer/invoice push, settings) are NEVER cron-bypassable.
var CRON_ALLOWED_PERMS = { 'wave.import.run': 1, 'wave.categories.pull': 1 };

// One-call route guard. CRON bearer bypasses ONLY for scheduled-job permissions; otherwise
// resolves the user and checks the specific permission.
export async function assertPermission(db, userId, perm, request) {
  var cronSecret = process.env.CRON_SECRET;
  var authHeader = '';
  try { authHeader = (request && request.headers && request.headers.get && request.headers.get('authorization')) || ''; } catch (eH) { authHeader = ''; }
  if (cronSecret && authHeader === ('Bearer ' + cronSecret) && CRON_ALLOWED_PERMS[perm]) { return { ok: true, via: 'cron' }; }

  if (!userId) { return { ok: false, status: 403, error: 'Unauthorized — this action requires the "' + perm + '" permission (no user provided).' }; }
  var ctx = await loadUserPermissions(db, userId);
  if (userHasPermission(ctx, perm)) { return { ok: true, via: ctx.isSuperAdmin ? 'super_admin' : 'permission', ctx: ctx }; }
  return { ok: false, status: 403, error: 'You do not have permission to perform this action ("' + perm + '").' };
}
