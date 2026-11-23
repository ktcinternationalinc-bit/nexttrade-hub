import { authorizeBankVisibility, BankVisibilityError } from './bank-visibility.js';
import { PERMISSION_ALIASES, effectiveSwitch } from './permission-aliases.js';

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
// v55.83-UG — the alias table and the switch rule now live in permission-aliases.js (shared with the Settings page)


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

// v55.83-TP (Max, Nov 17: "an admin should also have restrictions unless he is the super admin") — these are NEVER granted by a
// role (owner / admin / any default): only the super admin, or a person Max switched on explicitly.
export var SENSITIVE_PERMS = { 'advances.manage': 1, 'pnl.view_margin': 1, 'accounting.view_totals': 1, 'bank_balances.view': 1, 'bank.view_private': 1, 'permissions.grant_sensitive': 1, 'bank.add_transactions': 1, 'invoice.delete': 1, 'payroll.view': 1, 'cash.manage': 1 }; // YF: recording Cash on Hand // XE: warehouse salaries // UM: deleting / voiding invoices // TQ: adding transactions by hand
export function isSensitivePerm(perm) { return SENSITIVE_PERMS[perm] === 1; }
function aliasesFor(perm) { return PERMISSION_ALIASES[perm] || [perm]; }

function mpHas(mpMap, perm) {
  if (!mpMap) { return false; }
  var keys = aliasesFor(perm);
  var i;
  for (i = 0; i < keys.length; i++) { if (mpMap[keys[i]] === true) { return true; } }
  return false;
}

// v55.83-UG (Max, Nov 18: "the admin should not just have access, i need to give him access") — accounting & banking come ONLY from
// the switches Max turns on (or the super admin). An owner / admin role no longer grants any of them; other Hub areas are unchanged.
var ACCT_PREFIXES = ['bank.', 'bank_transactions.', 'bank_balances.', 'bills.', 'wires.', 'journals.', 'accounting.', 'payments.', 'invoice.', 'invoices.',
  'customers.', 'ar.', 'pnl.', 'orders.', 'recon.', 'company.', 'advances.', 'commercial.', 'categories.', 'wave.', 'finance.', 'purchase_orders.', 'dashboard.', 'permissions.', 'payroll.'];
export function isAccountingPerm(perm) { var p = String(perm || ''); for (var i = 0; i < ACCT_PREFIXES.length; i++) { if (p.indexOf(ACCT_PREFIXES[i]) === 0) { return true; } } return false; }
function roleHas(role, perm) {
  if (!role) { return false; }
  if (SENSITIVE_PERMS[perm] === 1) { return false; } // TP — never from a role
  if ((role === 'owner' || role === 'admin') && isAccountingPerm(perm)) { return false; } // UG — owner / admin: only their switches
  var list = ROLE_DEFAULTS[role];
  if (!list) { return false; }
  if (list.indexOf('*') >= 0) { return true; }
  return list.indexOf(perm) >= 0;
}

// Loads the user's role + module_permissions and returns a resolver.
export async function loadUserPermissions(db, userId) {
  var role = null;
  var mpMap = {}; var denyMap = {};
  if (!userId) { return { role: null, isSuperAdmin: false, mp: mpMap, deny: denyMap }; }
  // v55.83-XK (Codex 22 Nov 19:38 / 23 Nov) — a FAILED read is remembered (readError) and denies everything below the super admin:
  // with an explicit OFF switch in play (P&L: See sales & revenue) a missing OFF row must never be read as "no OFF row".
  var readError = null;
  try {
    var uRes = await db.from('users').select('id, role').eq('id', userId).limit(1);
    if (uRes && uRes.error) { readError = 'users: ' + (uRes.error.message || 'error'); }
    var u = uRes && uRes.data && uRes.data[0];
    role = u ? u.role : null;
  } catch (eU) { role = null; readError = 'users: ' + ((eU && eU.message) || 'error'); }
  try {
    var mpRes = await db.from('module_permissions').select('module_name, has_access').eq('user_id', userId);
    if (mpRes && mpRes.error) { readError = 'module_permissions: ' + (mpRes.error.message || 'error'); }
    var rows = (mpRes && mpRes.data) || [];
    var i;
    for (i = 0; i < rows.length; i++) { if (rows[i].has_access === true) { mpMap[rows[i].module_name] = true; } else if (rows[i].has_access === false) { denyMap[rows[i].module_name] = true; } }
  } catch (eM) { mpMap = {}; denyMap = {}; readError = 'module_permissions: ' + ((eM && eM.message) || 'error'); }
  return { role: role, isSuperAdmin: role === 'super_admin', mp: mpMap, deny: denyMap, readError: readError };
}

// v55.83-XK (Max, 22 Nov: "build a permission that hides revenue too") — 'P&L: See sales & revenue'. ON for everyone who has
// P&L: View unless the super admin switched it OFF for that person (an explicit OFF row, under any of its names, wins for staff,
// owner and admin alike). OFF = a RESEARCHER: no sale price, invoiced amount, revenue, profit or margin anywhere, and none of the
// switches that lead to the same figures (REVENUE_CONFLICT_*) — the resolver refuses those too, whatever their own rows say.
export var REVENUE_PERMISSION = 'pnl.view_revenue';
export var ROLE_DEFAULTS_FOR_GATE = ROLE_DEFAULTS; // read-only use by the researcher gate (what a role grants by itself)
export var REVENUE_CONFLICT_PREFIXES = ['invoice.', 'invoices.', 'ar.', 'payments.', 'commercial.', 'accounting.customers.', 'customers.', 'dashboard.', 'bank_balances.'];
export var REVENUE_CONFLICT_KEYS = { 'pnl.view_margin': 1, 'accounting.view_invoicing': 1, 'accounting.view_totals': 1, 'wave.invoices.push': 1, 'wave.payments.push': 1, 'wave.customers.push': 1, 'reports.sales': 1, 'sales.view': 1 };
// v55.83-XK (inventory 23 Nov: ClickBooks, Wave, orders, reconciliation and bank routes also return customer money under their own
// switches) — a researcher is an ALLOW-LIST: among the accounting & banking switches only these three; every other one conflicts.
export var RESEARCHER_ALLOWED = { 'pnl.view': 1, 'pnl.edit_costs': 1, 'pnl.view_revenue': 1 };
export function isRevenueConflict(perm) {
  var p = String(perm || ''); if (RESEARCHER_ALLOWED[p] === 1) { return false; }
  if (REVENUE_CONFLICT_KEYS[p] === 1) { return true; }
  if (isAccountingPerm(p)) { return true; }
  for (var i = 0; i < REVENUE_CONFLICT_PREFIXES.length; i++) { if (p.indexOf(REVENUE_CONFLICT_PREFIXES[i]) === 0) { return true; } }
  return false;
}
// true only for a person the super admin switched OFF (never for the super admin)
export function revenueSwitchedOff(ctx) { return !!(ctx && ctx.isSuperAdmin !== true && effectiveSwitch(ctx.mp, ctx.deny, REVENUE_PERMISSION) === false); }

export function userHasPermission(ctx, perm) {
  if (!ctx) { return false; }
  if (perm === 'bank_balances.view') { return ctx.bankVisibility?.canViewBankBalances === true; }
  if (ctx.isSuperAdmin === true) { return true; }       // super_admin = all
  if (ctx.readError) { return false; }                  // v55.83-XK — a failed permission read grants nothing (fail closed)
  // v55.83-XK — revenue: default ON with P&L: View, an explicit OFF wins; OFF also refuses every switch that leads to revenue
  if (perm === REVENUE_PERMISSION) { return !revenueSwitchedOff(ctx) && userHasPermission(ctx, 'pnl.view'); }
  if (revenueSwitchedOff(ctx) && isRevenueConflict(perm)) { return false; }
  // v55.83-UG (Codex QA 18:06) — the canonical key counts too, and an OFF under any name of the switch wins (same rule as the Settings page)
  var eff = effectiveSwitch(ctx.mp, ctx.deny, perm);
  if (eff === true) { return true; }
  if (eff === false) { return false; }
  if (roleHas(ctx.role, perm)) { return true; }          // temporary role default (never a sensitive permission)
  return false;
}

// Only these permissions may be satisfied by the CRON_SECRET bearer, because only these are
// performed by genuine scheduled backend jobs (sync-pull import, scheduled category pull).
// Staff-only actions (payment/customer/invoice push, settings) are NEVER cron-bypassable.
var CRON_ALLOWED_PERMS = { 'wave.import.run': 1, 'wave.categories.pull': 1 };

// One-call route guard. CRON bearer bypasses ONLY for scheduled-job permissions; otherwise
// resolves the user and checks the specific permission.
export async function assertPermission(db, userId, perm, request) {
  if (perm === 'bank_balances.view') {
    try {
      // The supplied db is an existing server client. getUser receives the
      // actual bearer explicitly, so a supplied userId cannot select identity.
      var bank = await authorizeBankVisibility(request, function () { return db; }, process.env);
      if (!bank.canViewBankBalances) return { ok: false, status: 403, error: 'You do not have bank balance access.' };
      // v55.83-XK — a revenue researcher never sees bank balances (balances rebuild money received), whatever the grant says
      if (!bank.isVerifiedSuperAdmin) {
        var ctxB = await loadUserPermissions(db, bank.profileId || userId);
        if (ctxB.readError) return { ok: false, status: 503, error: 'Permissions could not be read — nothing shown.' };
        if (revenueSwitchedOff(ctxB)) return { ok: false, status: 403, error: 'Bank balances are not shown to a person with "P&L: See sales & revenue" switched off.' };
      }
      return { ok: true, via: bank.isVerifiedSuperAdmin ? 'verified_super_admin' : 'bank_balance_grant',
        ctx: { bankVisibility: { canViewBankBalances: true }, authUserId: bank.authUserId, profileId: bank.profileId } };
    } catch (error) {
      return { ok: false, status: error instanceof BankVisibilityError ? error.status : 500,
        error: error instanceof BankVisibilityError ? error.message : 'Bank balance access could not be verified.' };
    }
  }
  var cronSecret = process.env.CRON_SECRET;
  var authHeader = '';
  try { authHeader = (request && request.headers && request.headers.get && request.headers.get('authorization')) || ''; } catch (eH) { authHeader = ''; }
  if (cronSecret && authHeader === ('Bearer ' + cronSecret) && CRON_ALLOWED_PERMS[perm]) { return { ok: true, via: 'cron' }; }

  if (!userId) { return { ok: false, status: 403, error: 'Unauthorized — this action requires the "' + perm + '" permission (no user provided).' }; }
  var ctx = await loadUserPermissions(db, userId);
  if (ctx.readError && ctx.isSuperAdmin !== true) { return { ok: false, status: 503, error: 'Permissions could not be read right now — nothing was shown or changed. Try again.' }; } // v55.83-XK
  if (userHasPermission(ctx, perm)) { return { ok: true, via: ctx.isSuperAdmin ? 'super_admin' : 'permission', ctx: ctx }; }
  return { ok: false, status: 403, error: 'You do not have permission to perform this action ("' + perm + '").' };
}
