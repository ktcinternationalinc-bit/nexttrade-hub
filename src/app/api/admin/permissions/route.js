// v55.83-WW — Accounting-team permissions, step B (Max's requirement 1: "Only the Super Admin can grant sensitive financial
// permissions ... Nobody can increase their own permissions"; Codex 21 Nov: grant writes go through a verified server path).
// POST { action: 'set', target_user_id, module_name, has_access }  — turn ONE switch on or off for ONE person.
//   • acts only for the verified signed-in person (bearer token), never for an id in the request
//   • only the super admin changes switches (delegation to other admins is Max's decision — not built)
//   • nobody changes their own switches; a super admin's switches are never written (they have everything anyway)
//   • the switch is written under EVERY name it is stored under (permFamily), so OFF is really OFF on the server
//   • bank-balance / full-dashboard grants keep their own verified route (/api/bank-visibility)
//   • every change writes an audit row: who, for whom, which switch, before and after
// SWC-safe: var + string concatenation.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { permFamily } from '../../../../lib/permission-aliases';
import { audit } from '../../../../lib/audit-server';
import { researcherConflicts, researcherGuardInstalled, isResearcher, isConflictName, isRevenueName, SQL_MISSING_XK } from '../../../../lib/revenue-researcher-gate'; // v55.83-XK

export const dynamic = 'force-dynamic'; // Next.js route config (the one const the build needs)
var OWN_ROUTE = { 'bank.view_account_balances': 1, 'Bank: View Account Balances': 1, 'bank_balances.view': 1, 'dashboard.full': 1, 'Full dashboard access': 1, 'Banking information access': 1 };
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function fail(msg, status) { return NextResponse.json({ ok: false, error: msg }, { status: status || 400, headers: { 'Cache-Control': 'private, no-store' } }); }

export async function POST(req) {
  try {
    var body = {};
    try { body = await req.json(); } catch (eJ) { return fail('Send the change as JSON.', 400); }
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return fail(who.error, who.status || 401); }
    var me = who.userId;
    var db = admin();
    var meRow = await db.from('users').select('id, role, active').eq('id', me).limit(1);
    if (meRow.error) { return fail('Your profile could not be checked right now.', 503); }
    var mine = meRow.data && meRow.data[0];
    if (!mine || mine.active === false) { return fail('Your sign-in does not resolve to one active Hub user.', 403); }
    if (mine.role !== 'super_admin') { return fail('Only the super admin can change permission switches.', 403); }

    if (body.action !== 'set') { return fail('Unknown action.', 400); }
    var target = String(body.target_user_id || '');
    var name = String(body.module_name || '');
    var want = body.has_access;
    if (!UUID.test(target)) { return fail('A valid person is required.', 400); }
    if (!name || name.length > 120) { return fail('A valid switch name is required.', 400); }
    if (want !== true && want !== false) { return fail('Say ON or OFF (has_access true / false).', 400); }
    if (OWN_ROUTE[name]) { return fail('Use Settings → 🏦 Banking & Accounting Access to change bank-balance and full-dashboard access.', 400); }
    if (target.toLowerCase() === String(me).toLowerCase()) { return fail('Nobody can change their own permission switches.', 403); }
    var tRow = await db.from('users').select('id, role, active').eq('id', target).limit(1);
    if (tRow.error) { return fail('That person could not be checked right now.', 503); }
    var t = tRow.data && tRow.data[0];
    if (!t) { return fail('That person is not in the Hub.', 404); }
    if (t.role === 'super_admin') { return fail('A super admin already has every permission; their switches are not changed.', 409); }

    // v55.83-XK — a revenue researcher ("P&L: See sales & revenue" OFF) is a validated configuration (Codex 23 Nov):
    //   • switching it OFF needs the database step installed and NO switch that leads to the same figures (listed back);
    //   • while it is OFF, none of those switches can be turned ON. Switching revenue back ON is always allowed.
    if (isRevenueName(name) && want === false) {
      if (!(await researcherGuardInstalled(db))) { return fail(SQL_MISSING_XK, 409); }
      var cf = await researcherConflicts(db, target);
      if (cf.error) { return fail(cf.error, cf.status); }
      if (cf.conflicts.length) { return NextResponse.json({ ok: false, error: 'Not changed — turn these OFF for this person first (they show sales or customer money): ' + cf.conflicts.join(', ') + (cf.role && cf.role !== 'team' ? ' (some may come from the role "' + cf.role + '" — change the role if they cannot be switched off).' : '.'), conflicts: cf.conflicts }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } }); }
    }
    if (want === true && isConflictName(name)) {
      var rr = await isResearcher(db, target);
      if (rr.error) { return fail(rr.error, rr.status); }
      if (rr.off) { return fail('Not changed — this person has "P&L: See sales & revenue" switched OFF (a revenue researcher), and this switch shows sales or customer money. Switch revenue ON first if they should see it.', 409); }
    }

    var fam = permFamily(name); if (fam.indexOf(name) < 0) { fam.unshift(name); }
    var cur = await db.from('module_permissions').select('id, module_name, has_access').eq('user_id', target).in('module_name', fam);
    if (cur.error) { return fail('The current switches could not be read (' + cur.error.message + ') — nothing was changed.', 503); }
    var before = {}; (cur.data || []).forEach(function (r) { before[r.module_name] = r.has_access; });
    var ids = (cur.data || []).map(function (r) { return r.id; });
    if (ids.length) {
      var up = await db.from('module_permissions').update({ has_access: want }).in('id', ids);
      if (up.error) { return fail('The switch could not be saved (' + up.error.message + ') — nothing was changed.', 500); }
    }
    if (before[name] === undefined) {
      var ins = await db.from('module_permissions').insert({ user_id: target, module_name: name, has_access: want });
      if (ins.error) { return fail('The switch could not be saved (' + ins.error.message + ').', 500); }
    }
    var after = await db.from('module_permissions').select('module_name, has_access').eq('user_id', target);
    if (after.error) { return fail('Saved, but the switches could not be read back — reload before changing more.', 500); }
    var saved = {}; (after.data || []).forEach(function (r) { saved[r.module_name] = r.has_access; });
    await audit(db, me, 'permission_changed', 'user', target, { switch: name, names: fam, to: want, before: before, target_role: t.role });
    return NextResponse.json({ ok: true, target_user_id: target, module_name: name, has_access: want, saved: saved }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return fail('The permission change could not be completed (' + ((e && e.message) || 'error') + ').', 500);
  }
}
