// v55.83-UM (Max, Nov 18: "how do i give someone permission to delete an invoice" → a switch of its own; and to "should an
// accounting manager be able to delete or void invoices automatically, or only when you switch it on for them?": "switch it on")
// — ONE rule, used by the screens AND the server routes, for deleting, voiding, cancelling, archiving and restoring US invoices
// and proformas (including "Delete incl. Wave"): the super admin, or a person whose "Delete / void invoices 🔒" switch
// (invoice.delete) is ON. No role gives it — not Accounting Manager, Owner or Admin. The switch is resolved with the shared
// effectiveSwitch rule (every name of the switch; an OFF under any name wins), exactly like the Settings page shows it.
// Plain module (no 'use client'): safe to import from server routes.
import { effectiveSwitch } from './permission-aliases';

export var INVOICE_DELETE_PERM = 'invoice.delete';

// onMap: { name: true } (server ctx.mp) or the screen's modulePerms { name: true | false }; offMap: { name: true } (server ctx.deny)
export function canDeleteInvoices(isSuperAdmin, onMap, offMap) {
  if (isSuperAdmin === true) { return true; }
  var on = {}; var off = {};
  Object.keys(onMap || {}).forEach(function (k) { if (onMap[k] === true) { on[k] = true; } else if (onMap[k] === false) { off[k] = true; } });
  Object.keys(offMap || {}).forEach(function (k) { if (offMap[k] === true) { off[k] = true; } });
  return effectiveSwitch(on, off, INVOICE_DELETE_PERM) === true;
}

export var INVOICE_DELETE_DENIED = 'Deleting, voiding or archiving invoices needs the “Delete / void invoices 🔒” switch (Settings → 🏦 Banking & Accounting Access). Ask the super admin.';

export var LIFECYCLE_SQL_MISSING = 'Deleting / voiding invoices needs one database update first: run sql/v55-83-UM-invoice-delete.sql in Supabase (SQL Editor).';

// the database step's refusal code → a plain message and an HTTP status (shared by the two routes)
export function lifecycleRefusal(j, kind, action) {
  var k = kind === 'proforma' ? 'proforma' : 'invoice';
  var code = (j && j.code) || '';
  if (code === 'scope') { return { status: 403, msg: 'This ' + k + ' belongs to a business you are not a member of — ask the super admin.' }; }
  if (code === 'not_found') { return { status: 404, msg: 'This ' + k + ' is not there any more — refresh the list.' }; }
  if (code === 'wave') { return { status: 409, msg: 'This invoice is linked to Wave — use “🗑 Delete (incl. Wave)”, or void / archive it (keeps the Wave link).' }; }
  if (code === 'historical') { return { status: 409, msg: 'This invoice was imported from Wave — void or archive it instead (delete it inside Wave).' }; }
  if (code === 'payments') { return { status: 409, msg: 'This invoice has payment records — void or archive it instead. Payments are never deleted.' }; }
  if (code === 'converted') { return { status: 409, msg: 'This proforma was converted to an invoice — void or archive it instead.' }; }
  if (code === 'state') { return { status: 409, msg: 'This ' + k + ' cannot be ' + (action === 'cancel' ? 'cancelled' : action === 'void' ? 'voided' : action === 'delete' ? 'deleted' : action + 'd') + ' while it is ' + ((j && j.status) || 'in this state') + ' — refresh the list.' }; }
  return { status: 400, msg: 'Not saved (' + (code || 'refused') + ').' };
}
