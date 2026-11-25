// v55.83-XE (Max, 21 Nov 2026: "only privileged can see the warehouse salaries") — one place that says what is payroll and
// what someone WITHOUT the 'payroll.view' switch gets instead. Server-only (no 'use client'); SWC-safe: var + concatenation.
//
//   • 'payroll.view' is SENSITIVE: never from any role; only the super admin, or a person the super admin switched on.
//   • A payroll line / bill stays VISIBLE as "Warehouse staff" with its date (nothing silently disappears), but its amount,
//     name and description are removed: amount = null and payroll_restricted = true. null is NOT zero.
//   • Any total that a payroll amount could be subtracted out of is withheld or clearly labelled as "without payroll".
//   • Lowering sensitivity (moving a line out of a payroll category, switching a category's payroll mark off, pairing a
//     payroll line as a transfer) is the super admin's own, audited action — never a side effect of ordinary categorizing.
import { assertPermission, loadUserPermissions } from './server-permissions';

export var PAYROLL_PERM = 'payroll.view';
export var PAYROLL_NAME = 'Warehouse staff';
export var PAYROLL_NOTE = 'Payroll amount restricted — payroll is shown to the super admin only.';

// { canSee, isSuperAdmin } for the verified caller. Fails CLOSED: any problem reading permissions = cannot see.
// v55.83-ZD (Max, 25 Nov: "should only be displayed to superadmin") — the SUPER ADMIN ONLY. The 'payroll.view' switch is retired:
// it no longer lets anyone else see payroll (nobody but the super admin had it ON when this was built).
export async function payrollScope(db, userId, req) {
  var sup = false;
  try { var ctx = await loadUserPermissions(db, userId); sup = !!(ctx && ctx.isSuperAdmin === true && !ctx.readError); } catch (e2) { sup = false; }
  return { canSee: sup, isSuperAdmin: sup };
}

// The keys of a company's payroll categories ({ key: true }).
export function payrollKeys(cats) {
  var o = {}; (cats || []).forEach(function (c) { if (c && c.is_payroll === true && c.key) { o[c.key] = true; } }); return o;
}
export function isPayrollVendorName(n) { return /^\s*warehouse staff/i.test(String(n || '')); }

// A bank line as a person without the switch sees it: date, direction, account and category stay; name, description and
// amount do not.
export function maskPayrollLine(l) {
  return Object.assign({}, l, { name: PAYROLL_NAME, merchant_name: null, amount_abs: null, amount: null, payroll_restricted: true });
}
// A bill as a person without the switch sees it.
export function maskPayrollBill(b) {
  if (!b) { return b; }
  return Object.assign({}, b, { vendor_name: PAYROLL_NAME, total_amount: null, amount_due: null, notes: null, payroll_restricted: true });
}
