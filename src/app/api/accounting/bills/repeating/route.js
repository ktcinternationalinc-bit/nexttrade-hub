// /api/accounting/bills/repeating — v55.83-TV. REPEATING BILLS (Max, Nov 17 2026).
//
// GET  — the daily job (vercel.json cron). Needs Authorization: Bearer CRON_SECRET; refused when the secret is not set.
//        Makes every due bill of every active repeating bill (src/lib/repeating-bills-server.js).
// POST — the 🔁 Repeating bills screen. Actions:
//        list (Bills: View or Manage) · save, pause, resume, stop, run_now, make_anyway (Bills: Manage).
//        Writes act only for the verified signed-in person (bearer token), never for a user_id in the body.
// Nothing is ever deleted: "stop" keeps the repeating bill and every bill it made.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../../lib/verified-caller';
import { audit } from '../../../../../lib/audit-server';
import { US_WAVE_BUSINESS_ID } from '../../../../../lib/business-of';
import { validateRepeating, nextDate, scheduleWords, FREQUENCIES, isDateStr } from '../../../../../lib/repeating-bills';
import { runRepeatingBills, makeSkippedAnyway, todayNY } from '../../../../../lib/repeating-bills-server';

var API_BUILD_MARKER = 'v55.83-TV-repeating-bills';
export const maxDuration = 60;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function missingRel(e) { return /does not exist|schema cache|Could not find the table|column/i.test(String((e && e.message) || '')); }
var SQL_MISSING = 'Repeating bills need one database update first: run sql/v55-83-TV-repeating-bills.sql in Supabase (SQL Editor).';

export async function GET(req) {
  var secret = process.env.CRON_SECRET;
  if (!secret) { return NextResponse.json({ ok: false, error: 'CRON_SECRET is not set — the daily job will not run without it.' }, { status: 503 }); }
  if ((req.headers.get('authorization') || '') !== 'Bearer ' + secret) { return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }); }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return NextResponse.json({ ok: false, error: 'Server key missing.' }, { status: 500 }); }
  var db = admin();
  var r = await runRepeatingBills(db, {});
  if (!r.ok && missingRel({ message: r.error })) { return NextResponse.json({ ok: false, error: SQL_MISSING, api_build_marker: API_BUILD_MARKER }); }
  r.api_build_marker = API_BUILD_MARKER;
  return NextResponse.json(r, { status: r.ok ? 200 : 503 });
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return NextResponse.json({ error: 'Server key missing.' }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var action = String(body.action || '');
    var WRITES = { save: 1, pause: 1, resume: 1, stop: 1, run_now: 1, make_anyway: 1 };
    if (action !== 'list' && !WRITES[action]) { return NextResponse.json({ error: 'Unknown action.' }, { status: 400 }); }
    var userId = body.user_id;
    if (WRITES[action]) {
      var who = await verifiedCaller(req, body, createClient);
      if (who.error) { return NextResponse.json({ error: who.error }, { status: who.status || 401 }); }
      userId = who.userId;
    }
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }
    var g1 = await assertPermission(db, userId, 'accounting.view', req);
    if (!g1 || g1.ok !== true) { return NextResponse.json({ error: 'This needs "Accounting Access" (P1) — grant it in Settings → 🏦 Banking & Accounting Access.' }, { status: (g1 && g1.status) || 403 }); }
    var g2 = await assertPermission(db, userId, 'bills.manage', req);
    if ((!g2 || g2.ok !== true) && !WRITES[action]) { g2 = await assertPermission(db, userId, 'bills.view', req); }
    if (!g2 || g2.ok !== true) { return NextResponse.json({ error: 'This needs the "' + (WRITES[action] ? 'Bills: Manage' : 'Bills: View') + '" permission — grant it in Settings → 🏦 Banking & Accounting Access.' }, { status: (g2 && g2.status) || 403 }); }
    var today = todayNY();

    if (action === 'list') {
      var lr = await db.from('recurring_bills').select('*').order('created_at', { ascending: false });
      if (lr.error) { return NextResponse.json(missingRel(lr.error) ? { ok: true, rows: [], sql_missing: SQL_MISSING } : { error: 'Could not read the repeating bills (' + lr.error.message + ').' }, { status: missingRel(lr.error) ? 200 : 503 }); }
      var rows = lr.data || [];
      var ids = rows.map(function (r) { return r.id; });
      var runs = [];
      if (ids.length) {
        var rr = await db.from('recurring_bill_runs').select('recurring_id, occurrence_date, outcome, bill_id, message, updated_at').in('recurring_id', ids).order('occurrence_date', { ascending: false });
        if (rr.error) { return NextResponse.json({ error: 'Could not read what the repeating bills made (' + rr.error.message + ').' }, { status: 503 }); }
        runs = rr.data || [];
      }
      var byRb = {};
      runs.forEach(function (x) { (byRb[x.recurring_id] = byRb[x.recurring_id] || []).push(x); });
      var outRows = rows.map(function (r) {
        var mine = byRb[r.id] || []; var done = {};
        mine.forEach(function (x) { if (x.outcome === 'created' || x.outcome === 'skipped_duplicate') { done[String(x.occurrence_date).substring(0, 10)] = true; } });
        var made = mine.filter(function (x) { return x.outcome === 'created'; });
        return Object.assign({}, r, {
          schedule_words: scheduleWords(r),
          next_date: r.status === 'stopped' ? null : nextDate(r, done),
          last_made: made.length ? made[0] : null,
          made_count: made.length,
          skipped: mine.filter(function (x) { return x.outcome === 'skipped_duplicate'; }).slice(0, 10),
          failed: mine.filter(function (x) { return x.outcome === 'failed'; }).slice(0, 5),
        });
      });
      return NextResponse.json({ ok: true, rows: outRows, today: today, frequencies: FREQUENCIES, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'save') {
      var id = body.repeating && body.repeating.id ? String(body.repeating.id) : null;
      var cur = null;
      if (id) {
        cur = await db.from('recurring_bills').select('*').eq('id', id).maybeSingle();
        if (cur.error) { return NextResponse.json({ error: 'Could not read the repeating bill (' + cur.error.message + ') — nothing changed.' }, { status: 503 }); }
        if (!cur.data) { return NextResponse.json({ error: 'Repeating bill not found.' }, { status: 404 }); }
        if (cur.data.status === 'stopped') { return NextResponse.json({ error: 'This repeating bill is stopped — set up a new one instead.' }, { status: 409 }); }
      }
      var v = validateRepeating(body.repeating || {}, today, { keepStart: cur && cur.data ? cur.data.start_date : null });
      if (!v.ok) { return NextResponse.json({ error: v.error }, { status: 400 }); }
      var row = v.row; var stamp = new Date().toISOString();
      if (!id) {
        // v55.83-TV — the company is always stated. Today repeating bills are KTC bills (the US books); a Nextrade or
        // RTM repeating bill needs its own company and is refused here rather than silently landing in KTC.
        var comp = String((body.repeating && body.repeating.wave_business_id) || US_WAVE_BUSINESS_ID);
        if (comp !== US_WAVE_BUSINESS_ID) { return NextResponse.json({ error: 'Repeating bills are for KTC bills.' }, { status: 400 }); }
        row.wave_business_id = comp; row.status = 'active'; row.created_by = userId; row.updated_by = userId; row.updated_at = stamp;
        var ins = await db.from('recurring_bills').insert(row).select('*').maybeSingle();
        if (ins.error) { return NextResponse.json({ error: missingRel(ins.error) ? SQL_MISSING : 'Not saved (' + ins.error.message + ').' }, { status: missingRel(ins.error) ? 409 : 500 }); }
        await audit(db, userId, 'repeating_bill_created', 'recurring_bill', ins.data.id, { vendor: row.vendor_name, amount: row.amount, schedule: scheduleWords(row), lead_days: row.lead_days });
        var first = await runRepeatingBills(db, { onlyId: ins.data.id, actorId: userId, today: today });
        return NextResponse.json({ ok: true, id: ins.data.id, created: true, run: first });
      }
      // an edit changes FUTURE bills only: bills already made stay as they are; when the dates change, nothing is made
      // for dates before today (no surprise catch-up of old dates under the new schedule)
      var schedChanged = cur.data.frequency !== row.frequency || String(cur.data.start_date) !== row.start_date || String(cur.data.end_date || '') !== String(row.end_date || '');
      var patch = Object.assign({}, row, { updated_by: userId, updated_at: stamp });
      if (schedChanged) { patch.resume_from = today; }
      var upd = await db.from('recurring_bills').update(patch).eq('id', id).neq('status', 'stopped').select('id');
      if (upd.error) { return NextResponse.json({ error: 'Not saved (' + upd.error.message + ').' }, { status: 500 }); }
      if (!upd.data || !upd.data.length) { return NextResponse.json({ error: 'Not saved — it was stopped meanwhile. Refresh.' }, { status: 409 }); }
      var changed = {}; Object.keys(row).forEach(function (k) { if (String(cur.data[k] == null ? '' : cur.data[k]) !== String(row[k] == null ? '' : row[k])) { changed[k] = { from: cur.data[k], to: row[k] }; } });
      await audit(db, userId, 'repeating_bill_edited', 'recurring_bill', id, { vendor: row.vendor_name, changed: changed, future_only: true });
      return NextResponse.json({ ok: true, id: id, updated: true });
    }

    var rid = String(body.id || '');
    if (!rid) { return NextResponse.json({ error: 'id required' }, { status: 400 }); }
    var cr = await db.from('recurring_bills').select('*').eq('id', rid).maybeSingle();
    if (cr.error) { return NextResponse.json({ error: 'Could not read the repeating bill (' + cr.error.message + ') — nothing changed.' }, { status: 503 }); }
    if (!cr.data) { return NextResponse.json({ error: 'Repeating bill not found.' }, { status: 404 }); }

    if (action === 'pause' || action === 'resume' || action === 'stop') {
      var from = cr.data.status; var to = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped';
      if (from === 'stopped') { return NextResponse.json({ error: 'This repeating bill is already stopped.' }, { status: 409 }); }
      if (from === to) { return NextResponse.json({ ok: true, status: to, unchanged: true }); }
      if (action === 'pause' && from !== 'active') { return NextResponse.json({ error: 'Only an active repeating bill can be paused.' }, { status: 409 }); }
      if (action === 'resume' && from !== 'paused') { return NextResponse.json({ error: 'Only a paused repeating bill can be resumed.' }, { status: 409 }); }
      var why = String(body.reason || '').trim().substring(0, 300) || null;
      var p2 = { status: to, updated_by: userId, updated_at: new Date().toISOString() };
      if (action === 'resume') { p2.resume_from = today; } // nothing is made for the paused time
      var u2 = await db.from('recurring_bills').update(p2).eq('id', rid).eq('status', from).select('id');
      if (u2.error) { return NextResponse.json({ error: 'Not changed (' + u2.error.message + ').' }, { status: 500 }); }
      if (!u2.data || !u2.data.length) { return NextResponse.json({ error: 'Someone changed it meanwhile — refresh.' }, { status: 409 }); }
      await audit(db, userId, 'repeating_bill_' + (action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'stopped'), 'recurring_bill', rid, { vendor: cr.data.vendor_name, from: from, to: to, reason: why });
      var runR = action === 'resume' ? await runRepeatingBills(db, { onlyId: rid, actorId: userId, today: today }) : null;
      return NextResponse.json({ ok: true, status: to, run: runR });
    }

    if (action === 'run_now') {
      if (cr.data.status !== 'active') { return NextResponse.json({ error: 'Only an active repeating bill makes bills.' }, { status: 409 }); }
      var rn = await runRepeatingBills(db, { onlyId: rid, actorId: userId, today: today });
      return NextResponse.json(rn, { status: rn.ok ? 200 : 503 });
    }

    if (action === 'make_anyway') {
      if (!isDateStr(body.date)) { return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 }); }
      var ma = await makeSkippedAnyway(db, rid, body.date, userId);
      return NextResponse.json(ma, { status: ma.ok ? 200 : (ma.status || 500) });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
