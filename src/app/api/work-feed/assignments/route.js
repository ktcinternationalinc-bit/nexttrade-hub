// v55.83-AAH — Work assignments for the 📋 work feed (Max, 27 Nov: "a dashboard where the admin or the super admin can select specific
// people, users for each task"). One app_settings row (key work_feed_assignments) — NO new table, NO SQL.
//   GET  — any signed-in active team member: who is assigned to each task (names only), and whether they may edit. Editors (admin /
//          super admin) also get the active users and, per task, whether each person's switches already let them see it.
//   POST — admin / super admin only: save { tasks: { taskKey: { primary, backup } }, expected_at }. Only known tasks and active users.
//          Refused when someone else saved meanwhile (expected_at). Every save is on the audit trail with what changed.
// An assignment never grants a permission: the feed shows a task only to people whose switches already show it.
// SWC-safe (var + concatenation).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { loadUserPermissions, userHasPermission } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server';
import { isActiveUser } from '../../../../lib/active-users';
import { ASSIGNMENTS_KEY, FEED_TASKS, taskOf, canAssign, cleanAssignments, meetsTask, assignmentDiff } from '../../../../lib/work-feed-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

var API_BUILD_MARKER = 'v55.83-AAH-work-assignments';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function out(body, status) { return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, body), { status: status || 200, headers: { 'Cache-Control': 'no-store' } }); }

async function caller(request, body) {
  var db = admin();
  var who = await verifiedCaller(request, body || {}, admin);
  if (who.error) { return { error: who.error, status: who.status || 401 }; }
  var ctx = await loadUserPermissions(db, who.userId);
  if (!ctx || !ctx.role || ctx.readError) { return { error: 'Your team access could not be verified.', status: 403 }; }
  return { db: db, userId: who.userId, ctx: ctx };
}

// both app_settings shapes (key/value jsonb and legacy setting_key/setting_value text), like the visibility setting
async function readAssignments(db) {
  var res = await db.from('app_settings').select('*').or('key.eq.' + ASSIGNMENTS_KEY + ',setting_key.eq.' + ASSIGNMENTS_KEY).limit(1);
  if (res && res.error) { res = await db.from('app_settings').select('*').eq('key', ASSIGNMENTS_KEY).limit(1); }
  if (!res || res.error) { return { ok: false, error: (res && res.error && res.error.message) || 'not readable' }; }
  var row = res.data && res.data.length ? res.data[0] : null; var val = null;
  if (row) { if (row.value && typeof row.value === 'object') { val = row.value; } else if (row.setting_value) { try { val = JSON.parse(row.setting_value); } catch (eP) { val = null; } } }
  return { ok: true, tasks: cleanAssignments(val), at: (val && val.at) || null, by_name: (val && val.by_name) || null };
}

async function writeAssignments(db, value, by) {
  var now = new Date().toISOString();
  var up = await db.from('app_settings').upsert({ key: ASSIGNMENTS_KEY, value: value, setting_key: ASSIGNMENTS_KEY, setting_value: JSON.stringify(value), updated_by: by || null, updated_at: now }, { onConflict: 'key' }).select('key');
  if (up && up.error && /setting_key|setting_value|updated_by|column/.test(up.error.message || '')) { up = await db.from('app_settings').upsert({ key: ASSIGNMENTS_KEY, value: value, updated_at: now }, { onConflict: 'key' }).select('key'); }
  return up && up.error ? { error: up.error.message } : { ok: true };
}

async function activeUsers(db) {
  var r = await db.from('users').select('id, name, email, role, active').limit(1000);
  if (!r || r.error) { return { error: (r && r.error && r.error.message) || 'users not readable' }; }
  return { users: (r.data || []).filter(isActiveUser) };
}

export async function GET(request) {
  var c = await caller(request, {});
  if (c.error) { return out({ ok: false, error: c.error }, c.status); }
  var a = await readAssignments(c.db);
  if (!a.ok) { return out({ ok: false, error: 'Work assignments could not be read right now.' }, 503); }
  var editor = canAssign(c.ctx.role);
  var ids = {}; Object.keys(a.tasks).forEach(function (k) { if (a.tasks[k].primary) { ids[a.tasks[k].primary] = 1; } if (a.tasks[k].backup) { ids[a.tasks[k].backup] = 1; } });
  var names = {}; var people = null;
  var au = await activeUsers(c.db);
  if (au.error) { return out({ ok: false, error: 'The team list could not be read right now.' }, 503); }
  au.users.forEach(function (u) { if (ids[u.id]) { names[u.id] = u.name || u.email || 'someone'; } });
  if (editor) {
    people = [];
    for (var i = 0; i < au.users.length; i++) {
      var u = au.users[i]; var pc = await loadUserPermissions(c.db, u.id);
      var sees = {}; FEED_TASKS.forEach(function (t) { sees[t.key] = pc && !pc.readError ? meetsTask(t, function (p) { return userHasPermission(pc, p); }) : null; });
      people.push({ id: u.id, name: u.name || u.email || 'someone', role: u.role || null, sees: sees });
    }
    people.sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
  }
  return out({ ok: true, tasks: a.tasks, names: names, at: a.at, by_name: a.by_name, can_edit: editor, catalog: FEED_TASKS.map(function (t) { return { key: t.key, label: t.label, job: t.job, live: t.live, needs: t.needsWords }; }), people: people });
}

export async function POST(request) {
  var body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object') { body = {}; }
  var c = await caller(request, body);
  if (c.error) { return out({ ok: false, error: c.error }, c.status); }
  if (!canAssign(c.ctx.role)) { return out({ ok: false, error: 'Only an admin or the super admin can assign work.' }, 403); }
  var before = await readAssignments(c.db);
  if (!before.ok) { return out({ ok: false, error: 'Work assignments could not be read, so nothing was saved. Try again.' }, 503); }
  if ((before.at || null) !== (body.expected_at || null)) { return out({ ok: false, error: 'Someone else saved the assignments while you were editing. Press ↻ to load theirs, then make your change again.', stale: true }, 409); }
  var au = await activeUsers(c.db);
  if (au.error) { return out({ ok: false, error: 'The team list could not be read, so nothing was saved.' }, 503); }
  var activeIds = {}; au.users.forEach(function (u) { activeIds[u.id] = 1; });
  var raw = body.tasks && typeof body.tasks === 'object' ? body.tasks : {};
  var bad = [];
  Object.keys(raw).forEach(function (k) {
    if (!taskOf(k)) { bad.push('unknown task ' + k); return; }
    var a = raw[k] || {};
    ['primary', 'backup'].forEach(function (f) { if (a[f] && !activeIds[a[f]]) { bad.push(taskOf(k).label + ': the ' + f + ' person is not an active team member'); } });
  });
  if (bad.length) { return out({ ok: false, error: 'Nothing was saved: ' + bad.join('; ') + '.' }, 400); }
  var tasks = cleanAssignments({ tasks: raw });
  var me = await c.db.from('users').select('id, name, email').eq('id', c.userId).maybeSingle(); var meR = (me && me.data) || {};
  var value = { version: 1, tasks: tasks, by: c.userId, by_name: meR.name || meR.email || null, at: new Date().toISOString() };
  var w = await writeAssignments(c.db, value, c.userId);
  if (w.error) { return out({ ok: false, error: 'The assignments could not be saved (' + w.error + '). Nothing changed.' }, 503); }
  try { await audit(c.db, c.userId, 'work_feed_assignments_saved', 'setting', ASSIGNMENTS_KEY, { changes: assignmentDiff(before.tasks, tasks) }); } catch (eA) { /* the save stands; the audit helper never throws */ }
  return out({ ok: true, tasks: tasks, at: value.at, by_name: value.by_name });
}
