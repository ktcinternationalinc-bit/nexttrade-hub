// v55.83-YQ — the STOP switch for warehouse releases (Max, 24 Nov 2026). GET = its state, for any signed-in team member who can
// open Change Schedule. POST = switch it; ONLY the super admin; a reason is required to stop; every change is on the audit trail.
// This route moves nothing and never talks to the warehouse. SWC-safe (var + concat).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { loadUserPermissions } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server';
import { RELEASE_PAUSE_KEY, readReleasePause, writeReleasePause, pauseReason, pauseSentence } from '../../../../lib/release-pause';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

var API_BUILD_MARKER = 'v55.83-YQ-release-pause';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function out(body, status) { return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, body), { status: status || 200, headers: { 'Cache-Control': 'no-store' } }); }

async function caller(request, body) {
  var db = admin();
  var who = await verifiedCaller(request, body || {}, admin);
  if (who.error) { return { error: who.error, status: who.status || 401 }; }
  var ctx = await loadUserPermissions(db, who.userId);
  if (!ctx || !ctx.role || ctx.readError) { return { error: 'Your team access could not be verified.', status: 403 }; }
  return { db: db, userId: who.userId, ctx: ctx };
}

export async function GET(request) {
  var c = await caller(request, {});
  if (c.error) { return out({ ok: false, error: c.error }, c.status); }
  var p = await readReleasePause(c.db);
  return out({ ok: true, pause: { paused: p.paused, unreadable: p.unreadable === true, by_name: p.by_name || null, at: p.at || null, reason: p.reason || null, sentence: pauseSentence(p) }, can_switch: c.ctx.isSuperAdmin === true });
}

export async function POST(request) {
  var body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object') { body = {}; }
  var c = await caller(request, body);
  if (c.error) { return out({ ok: false, error: c.error }, c.status); }
  if (c.ctx.isSuperAdmin !== true) { return out({ ok: false, error: 'Only the super admin can stop or restart warehouse releases.' }, 403); }
  if (body.paused !== true && body.paused !== false) { return out({ ok: false, error: 'Say stop or restart.' }, 400); }
  var reason = null;
  if (body.paused === true) {
    var pr = pauseReason(body.reason);
    if (!pr.ok) { return out({ ok: false, error: pr.error }, 400); }
    reason = pr.reason;
  } else if (body.confirm !== 'RESTART') { return out({ ok: false, error: 'Restarting warehouse releases needs your confirmation.' }, 400); }
  var me = await c.db.from('users').select('id, name, email').eq('id', c.userId).maybeSingle();
  var meR = (me && me.data) || {};
  var before = await readReleasePause(c.db);
  var value = { paused: body.paused, by: c.userId, by_name: meR.name || meR.email || null, at: new Date().toISOString(), reason: reason };
  var w = await writeReleasePause(c.db, value, c.userId);
  if (w.error) { return out({ ok: false, error: 'The stop switch could not be saved (' + w.error + '). Nothing changed.' }, 503); }
  try { await audit(c.db, c.userId, body.paused ? 'warehouse_releases_stopped' : 'warehouse_releases_restarted', 'setting', RELEASE_PAUSE_KEY, { from: { paused: before.paused === true && before.unreadable !== true, reason: before.reason || null }, to: { paused: body.paused, reason: reason } }); } catch (eA) { /* the setting row itself records who and when */ }
  return out({ ok: true, pause: { paused: value.paused, unreadable: false, by_name: value.by_name, at: value.at, reason: value.reason, sentence: pauseSentence(value) }, can_switch: true });
}
