// v55.83-QI — 🧾 AUDIT TRAIL (Max, Nov 7 12:33: "should be audit of whoever
// changes or matches or creates or validates etc.. separate audit record
// also permissioning"). Read-only merge of the hub's append-only audit log
// and the bill event trail, newest first, with actor names resolved.
// Viewing needs its own permission: audit.view (super admins always pass).
// There is NO write action here — audit rows cannot be edited or deleted
// through the app, by anyone.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function POST(req) {
  try {
    var body = await req.json();
    var d = db();
    var userId = body.user_id;
    if (!userId) { return NextResponse.json({ ok: false, error: 'user_id required.' }, { status: 401 }); }
    var gate = await assertPermission(d, userId, 'audit.view', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: 'The Audit Trail needs the "Audit: View Trail" permission — grant it in Settings → Permissions.' }, { status: gate.status || 403 }); }

    if (body.action !== 'list') { return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 }); }
    var limit = Math.min(Math.max(Number(body.limit) || 200, 20), 500);

    var rows = [];
    var hub = await d.from('hub_audit_log').select('at, actor_id, action, entity, entity_id, details').order('at', { ascending: false }).limit(limit);
    if (hub.error && /hub_audit_log/.test(hub.error.message || '')) {
      return NextResponse.json({ ok: false, needs_sql: true, error: 'Run sql/v55-83-QI-audit-log.sql first — the audit table does not exist yet.' }, { status: 503 });
    }
    (hub.data || []).forEach(function (r) { rows.push({ at: r.at, actor_id: r.actor_id, action: r.action, entity: r.entity, entity_id: r.entity_id, details: r.details, source: 'hub' }); });
    try {
      var ev = await d.from('vendor_bill_events').select('created_at, actor_id, kind, bill_id, details').order('created_at', { ascending: false }).limit(limit);
      var billIds = {};
      (ev.data || []).forEach(function (e) { if (e.bill_id) { billIds[e.bill_id] = true; } });
      var bMap = {};
      var bIdList = Object.keys(billIds).slice(0, 300);
      if (bIdList.length) {
        var bq = await d.from('vendor_bills').select('id, vendor_name, bill_number').in('id', bIdList);
        (bq.data || []).forEach(function (b) { bMap[b.id] = (b.vendor_name || '') + (b.bill_number ? ' · ' + b.bill_number : ''); });
      }
      (ev.data || []).forEach(function (e) {
        rows.push({ at: e.created_at, actor_id: e.actor_id, action: 'bill_' + e.kind, entity: 'vendor_bill', entity_id: bMap[e.bill_id] || e.bill_id, details: e.details, source: 'bill_events' });
      });
    } catch (eE) { /* bill events optional */ }

    rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    rows = rows.slice(0, limit);

    // resolve actor names (fail-soft)
    var names = {};
    try {
      var ids = {}; rows.forEach(function (r) { if (r.actor_id) { ids[r.actor_id] = true; } });
      var idl = Object.keys(ids).slice(0, 200);
      if (idl.length) {
        var pr = await d.from('profiles').select('id, name, email').in('id', idl);
        (pr.data || []).forEach(function (p) { names[p.id] = p.name || p.email || p.id; });
      }
    } catch (eN) {}
    rows.forEach(function (r) { r.who = r.actor_id ? (names[r.actor_id] || r.actor_id) : '(system / scheduled job)'; });

    var q = String(body.q || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        return (String(r.action) + ' ' + String(r.who) + ' ' + String(r.entity_id || '') + ' ' + JSON.stringify(r.details || {})).toLowerCase().indexOf(q) >= 0;
      });
    }
    return NextResponse.json({ ok: true, rows: rows, count: rows.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'Server error' }, { status: 500 });
  }
}
