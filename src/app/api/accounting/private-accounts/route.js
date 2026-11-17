// v55.83-TP — /api/accounting/private-accounts (Max, Nov 17: "I should be able to mark an account private where only the super
// admin or the ones I permission can see"). SUPER ADMIN ONLY, verified sign-in (never a user_id in the body).
//   POST { action: 'list' }                                   → { private: [plaid_account_id, …] }
//   POST { action: 'set', plaid_account_id, private: bool }   → marks / unmarks one account; audited
// The database (sql/v55-83-TP-permissions.sql) hides a private account's transactions from everyone else.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { loadUserPermissions } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server';

var API_BUILD_MARKER = 'v55.83-TP-private-accounts';
var SQL_HINT = 'Run sql/v55-83-TP-permissions.sql in Supabase first.';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function bad(msg, st) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: st || 400 }); }
function missingCol(e) { var m = String((e && e.message) || ''); return /is_private/.test(m) && /does not exist|schema cache/i.test(m); }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json().catch(function () { return {}; });
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status || 401); }
    var ctx = await loadUserPermissions(db, who.userId);
    if (ctx.isSuperAdmin !== true) { return bad('Only the super admin can see or change which accounts are private.', 403); }
    if (body.action === 'list') {
      var l = await db.from('plaid_accounts').select('plaid_account_id').eq('is_private', true);
      if (l.error) { return missingCol(l.error) ? NextResponse.json({ ok: true, private: [], setup_needed: true, sql_hint: SQL_HINT, api_build_marker: API_BUILD_MARKER }) : bad(l.error.message, 500); }
      return NextResponse.json({ ok: true, private: (l.data || []).map(function (a) { return a.plaid_account_id; }), api_build_marker: API_BUILD_MARKER });
    }
    if (body.action === 'set') {
      var id = String(body.plaid_account_id || '').trim(); if (!id) { return bad('Choose the account.'); }
      var on = body.private === true;
      var u = await db.from('plaid_accounts').update({ is_private: on }).eq('plaid_account_id', id).select('plaid_account_id, name, mask');
      if (u.error) { return missingCol(u.error) ? bad(SQL_HINT, 409) : bad(u.error.message, 500); }
      if (!u.data || !u.data.length) { return bad('That account was not found.', 404); }
      await audit(db, who.userId, on ? 'bank_account_made_private' : 'bank_account_made_visible', 'plaid_account', id, { name: u.data[0].name || null, mask: u.data[0].mask || null });
      return NextResponse.json({ ok: true, plaid_account_id: id, private: on, api_build_marker: API_BUILD_MARKER });
    }
    return bad('Unknown action.');
  } catch (e) { return bad((e && e.message) || 'failed', 500); }
}
