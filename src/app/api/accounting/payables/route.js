// v55.83-SJ — bills on the books before they are paid (accounts payable). Max, Nov 13 12:50: "of course, they're going to be
// put into the books before they're paid" · 12:52: "work on top 2 right now, top 3, and let's move forward."
//   status    — is it switched on, since when, what the ledger says we owe (anyone who can see bills)
//   set_start — switch it on from a date / off (SUPER ADMIN only; audited in the ledger's own event log)
// The posting itself is done by the 15-minute ledger job (sql/v55-83-SJ-bills-payable.sql). Var + concat only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

export var dynamic = 'force-dynamic';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function fail(msg, status) { return NextResponse.json({ ok: false, error: msg }, { status: status || 400 }); }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function notInstalled(e) { return /clickbooks_us_payables|does not exist|schema cache|PGRST202/i.test(String((e && e.message) || '')); }

export async function POST(req) {
  try {
    var body = await req.json();
    var db = admin(); var userId = body.user_id || null; var action = body.action;
    var g1 = await assertPermission(db, userId, 'accounting.clickbooks.access', req);
    if (!g1.ok) { return fail('This needs "P1a · ClickBooks (KTC Hub) Access" — Settings → 🏦 Banking & Accounting Access.', g1.status || 403); }
    var gB = await assertPermission(db, userId, 'bills.view', req);
    if (!gB.ok) { gB = await assertPermission(db, userId, 'bills.manage', req); }
    if (!gB.ok) { return fail('This needs "Bills: View".', 403); }

    if (action === 'status') {
      var s = await db.rpc('clickbooks_us_payables_status');
      if (s.error) { return NextResponse.json({ ok: true, installed: false, why: notInstalled(s.error) ? 'Run sql/v55-83-SJ-bills-payable.sql in Supabase first.' : s.error.message }); }
      return NextResponse.json(Object.assign({ ok: true, can_switch: !!(g1.ctx && g1.ctx.isSuperAdmin) }, s.data || {}));
    }

    if (action === 'set_start') {
      if (!(g1.ctx && g1.ctx.isSuperAdmin)) { return fail('Only the super admin can switch bills-on-the-books on or off.', 403); }
      var start = body.start_date == null || body.start_date === '' ? null : String(body.start_date);
      if (start !== null && !isDate(start)) { return fail('Pick the date to start from.'); }
      if (start !== null && start > new Date().toISOString().substring(0, 10)) { return fail('The start date cannot be in the future.'); }
      var r = await db.rpc('clickbooks_us_payables_set_start', { p_start: start, p_actor: userId });
      if (r.error) { return fail(notInstalled(r.error) ? 'Run sql/v55-83-SJ-bills-payable.sql in Supabase first.' : r.error.message, 400); }
      return NextResponse.json({ ok: true, start_date: start, was: r.data && r.data.was });
    }
    return fail('Unknown action.');
  } catch (e) { return fail((e && e.message) || 'Server error', 500); }
}
