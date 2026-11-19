// /api/accounting/invoice-lifecycle — v55.83-UM. Delete / void / cancel / archive / restore a US invoice or proforma ON THE SERVER.
// Before UM these ran in the browser (anon client) and only the button checked the role. Now: the verified signed-in person (never
// a user id sent by the browser) must have the "Delete / void invoices 🔒" switch ON (or be the super admin) — canDeleteInvoices,
// the shared effectiveSwitch rule — and the change itself runs in ONE locked database step, public.hub_invoice_lifecycle
// (sql/v55-83-UM-invoice-delete.sql): all of it or none of it. An invoice linked to Wave, imported from Wave or with ANY payment
// record is never hard-deleted (void or archive it); payment records are never deleted. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { loadUserPermissions } from '../../../../lib/server-permissions';
import { canDeleteInvoices, INVOICE_DELETE_DENIED, lifecycleRefusal, LIFECYCLE_SQL_MISSING } from '../../../../lib/invoice-delete-access';
import { audit } from '../../../../lib/audit-server';

export const dynamic = 'force-dynamic';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function fail(msg, st, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg }, extra || {}), { status: st || 400 }); }
var ACTIONS = { delete: 1, void: 1, cancel: 1, archive: 1, restore: 1 };
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  var body = null;
  try { body = await req.json(); } catch (eB) { return fail('The request could not be read.'); }
  var who = await verifiedCaller(req, body, createClient);
  if (who.error) { return fail(who.error, who.status || 401); }
  var userId = who.userId;
  var db = admin();
  try {
    var ctx = await loadUserPermissions(db, userId);
    if (!canDeleteInvoices(ctx.isSuperAdmin, ctx.mp, ctx.deny)) { return fail(INVOICE_DELETE_DENIED, 403); }
    var action = String(body.action || '');
    if (!ACTIONS[action]) { return fail('Unknown action.'); }
    var kind = body.kind === 'proforma' ? 'proforma' : 'invoice';
    var id = String(body.id || '');
    if (!UUID.test(id)) { return fail('Which ' + kind + '?'); }
    var r = await db.rpc('hub_invoice_lifecycle', { p: { kind: kind, action: action, id: id, actor: userId, is_super: ctx.isSuperAdmin === true, reason: String(body.reason || '').trim().substring(0, 300) || null } });
    if (r.error) {
      if (/hub_invoice_lifecycle/.test(String(r.error.message || '')) && /does not exist|Could not find|schema cache/i.test(String(r.error.message || ''))) { return fail(LIFECYCLE_SQL_MISSING, 409); }
      return fail('Not saved (' + r.error.message + '). Nothing was changed.', 500);
    }
    var j = r.data || {};
    if (!j.ok) { var why = lifecycleRefusal(j, kind, action); return fail(why.msg, why.status, { code: j.code }); }
    await audit(db, userId, kind + '_' + action, kind === 'proforma' ? 'accounting_proformas' : 'accounting_invoices', id, { name: j.name, from: j.from || null, released_bank_lines: j.released || 0 });
    return NextResponse.json({ ok: true, action: action, released: j.released || 0 });
  } catch (e) {
    return fail('Something went wrong on the server (' + ((e && e.message) || 'error') + '). Refresh and check before trying again.', 500);
  }
}
