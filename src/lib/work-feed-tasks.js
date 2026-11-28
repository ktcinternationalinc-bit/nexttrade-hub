// v55.83-AAH — Work assignments (Max, 27 Nov: "a dashboard where the admin or the super admin can select specific people, users for each
// task"). The list of feed task types, who may see each one today (the switches), and the stored assignment shape.
// An assignment NEVER grants anything: it only says whose job a task is. The feed still shows a task only to people whose switches
// already let them see it. Server-safe (no imports), SWC-safe (var + concatenation).
export var ASSIGNMENTS_KEY = 'work_feed_assignments';

// live: the feed shows these today. Later ones can be assigned now; their feed items come in later builds.
// needs: every group must be met; a group is met when ANY switch in it is on.
var KTC = ['accounting.clickbooks.access', 'accounting.view'];
var COSTS = [KTC, ['pnl.view'], ['pnl.view_revenue'], ['pnl.view_margin'], ['pnl.edit_costs']];
export var FEED_TASKS = [
  { key: 'bill_flags', label: 'Price flags on bills', job: 'Bills', live: true, needs: [KTC, ['bills.manage']], needsWords: 'Bills: Manage' },
  { key: 'bill_validate', label: 'Bills to validate', job: 'Bills', live: true, needs: [KTC, ['bills.manage']], needsWords: 'Bills: Manage' },
  { key: 'bill_ready', label: 'Bills not paid (validated, not on a wire)', job: 'Wires — prepare', live: true, needs: [KTC, ['wires.prepare']], needsWords: 'Wires: Prepare' },
  { key: 'wire_fix', label: 'Pre-wires to finish', job: 'Wires — prepare', live: true, needs: [KTC, ['wires.prepare']], needsWords: 'Wires: Prepare' },
  { key: 'transfer_unused', label: 'Transfer money not used yet', job: 'Wires — prepare', live: true, needs: [KTC, ['wires.prepare']], needsWords: 'Wires: Prepare' },
  { key: 'wire_sign', label: 'Wires to sign', job: 'Wires — sign', live: true, needs: [KTC, ['wires.signoff']], needsWords: 'Wires: Sign Off' },
  { key: 'wire_send', label: 'Wires to send', job: 'Wires — send', live: true, needs: [KTC, ['wires.send']], needsWords: 'Wires: Send' },
  { key: 'wire_bank', label: 'Sent wires with no bank line', job: 'Wires — send', live: true, needs: [KTC, ['wires.send']], needsWords: 'Wires: Send' },
  { key: 'wire_proof', label: 'Paid wires waiting for proof', job: 'Wires — send', live: true, needs: [KTC, ['wires.send']], needsWords: 'Wires: Send' },
  { key: 'invoice_bank', label: 'Egypt invoices awaiting bank confirmation', job: 'Egypt bank confirmations', live: true, needs: [['Treasury', 'View Financial Reports']], needsWords: 'Treasury or View Financial Reports' },
  { key: 'supplier_costs_missing', label: 'Missing supplier costs', job: 'Profitability', live: true, needs: COSTS, needsWords: 'Profitability: View, See profit and margin, and Edit Product Costs' },
  { key: 'shipment_costs_missing', label: 'Missing shipment costs and units', job: 'Profitability', live: true, needs: COSTS, needsWords: 'Profitability: View, See profit and margin, and Edit Product Costs' },
  { key: 'order_no_invoice', label: 'Shipped orders with no KTC invoice', job: 'Invoices', live: false, needs: [['invoice.create', 'Edit Invoices'], ['orders.monitor']], needsWords: 'Invoices: Create/Edit + Orders: Monitor' },
  { key: 'order_paperwork', label: 'Shipped orders — NT paperwork not complete', job: 'Order management', live: false, needs: [['orders.manage']], needsWords: 'Orders: Manage' },
  { key: 'order_preload', label: 'Pre-load orders missing items', job: 'Order management', live: false, needs: [['orders.manage']], needsWords: 'Orders: Manage' },
  { key: 'collections', label: 'Customers overdue / arrival and final-payment reminders', job: 'Collections', live: false, needs: [], needsWords: '' },
  { key: 'bank_lines', label: 'Bank deposits to match / expenses to categorize', job: 'Bank', live: false, needs: [], needsWords: '' },
  { key: 'warehouse_check', label: 'Warehouse check FAIL / REVIEW to decide', job: 'Warehouse check', live: false, needs: [], needsWords: '' }
];
export function taskOf(key) { var hit = null; FEED_TASKS.forEach(function (t) { if (t.key === key) { hit = t; } }); return hit; }

// who may assign: the super admin and admins (Max: "the admin or the super admin")
export function canAssign(role) { return role === 'super_admin' || role === 'admin'; }

// the stored value → a clean map { taskKey: { primary, backup } } (unknown tasks and bad ids dropped)
export function cleanAssignments(v) {
  var out = {}; var t = (v && typeof v === 'object' && v.tasks && typeof v.tasks === 'object') ? v.tasks : {};
  FEED_TASKS.forEach(function (task) {
    var a = t[task.key]; if (!a || typeof a !== 'object') { return; }
    var p = typeof a.primary === 'string' && a.primary ? a.primary : null; var b = typeof a.backup === 'string' && a.backup ? a.backup : null;
    if (b && b === p) { b = null; }
    if (p || b) { out[task.key] = { primary: p, backup: b }; }
  });
  return out;
}

// does a person's permission check (has(perm) → bool) meet a task's switches? A later task with no switch list yet → null (not known)
export function meetsTask(task, has) {
  if (!task || !task.needs || !task.needs.length) { return null; }
  return task.needs.every(function (group) { return group.some(function (perm) { return has(perm) === true; }); });
}

// what the save changed, for the audit row
export function assignmentDiff(before, after) {
  var ch = [];
  FEED_TASKS.forEach(function (t) {
    var a = before[t.key] || {}; var b = after[t.key] || {};
    if ((a.primary || null) !== (b.primary || null) || (a.backup || null) !== (b.backup || null)) { ch.push({ task: t.key, from: { primary: a.primary || null, backup: a.backup || null }, to: { primary: b.primary || null, backup: b.backup || null } }); }
  });
  return ch;
}
